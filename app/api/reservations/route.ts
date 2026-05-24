import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';
import { getCachedResponse, cacheResponse } from '@/lib/idempotency';
import { z } from 'zod';
import { StockLevel } from '@prisma/client';

export const dynamic = 'force-dynamic';

const reservationSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  warehouseId: z.string().min(1, 'Warehouse ID is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
});

export async function POST(request: Request) {
  // 1. Extract Idempotency-Key and check cache
  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey) {
    const cached = await getCachedResponse(idempotencyKey);
    if (cached) {
      return new NextResponse(JSON.stringify(cached.body), {
        status: cached.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = await request.json();
    const result = reservationSchema.safeParse(body);
    
    if (!result.success) {
      const errorResponse = { error: 'Validation failed', details: result.error.format() };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { productId, warehouseId, quantity } = result.data;

    // Execute the reservation process inside a database transaction to ensure absolute atomic safety
    const reservationResult = await prisma.$transaction(async (tx) => {
      // a. First, run lazy cleanup of expired reservations to reclaim available units
      await cleanupExpiredReservations(tx);

      // b. Lock the corresponding StockLevel row using pessimistic locking (FOR UPDATE)
      // This blocks concurrent requests from modifying or reading the stock level of this specific product/warehouse combo
      const stockLevels: StockLevel[] = await tx.$queryRaw`
        SELECT * FROM "StockLevel"
        WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
        FOR UPDATE
      `;

      if (stockLevels.length === 0) {
        throw new Error('STOCK_NOT_FOUND');
      }

      const stockLevel = stockLevels[0];
      const availableUnits = stockLevel.totalUnits - stockLevel.reservedUnits;

      // c. Check if we have sufficient available stock
      if (availableUnits < quantity) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // d. Decrement available stock by incrementing reservedUnits
      await tx.stockLevel.update({
        where: { id: stockLevel.id },
        data: {
          reservedUnits: {
            increment: quantity,
          },
        },
      });

      // e. Create a new reservation with a 10-minute expiry hold
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const newReservation = await tx.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          status: 'PENDING',
          expiresAt,
        },
        include: {
          product: true,
          warehouse: true,
        },
      });

      return newReservation;
    });

    const successResponse = {
      message: 'Reservation created successfully',
      reservation: {
        id: reservationResult.id,
        productId: reservationResult.productId,
        productName: reservationResult.product.name,
        warehouseId: reservationResult.warehouseId,
        warehouseName: reservationResult.warehouse.name,
        quantity: reservationResult.quantity,
        status: reservationResult.status,
        expiresAt: reservationResult.expiresAt.toISOString(),
      },
    };

    // Cache the successful response for idempotency
    if (idempotencyKey) {
      await cacheResponse(idempotencyKey, 201, successResponse);
    }

    return NextResponse.json(successResponse, { status: 201 });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '';
    console.error('POST /api/reservations error:', errorMessage || error);

    if (errorMessage === 'INSUFFICIENT_STOCK' || errorMessage === 'STOCK_NOT_FOUND') {
      const conflictResponse = {
        error: 'Conflict',
        message: 'Insufficient stock available to complete the reservation request.',
      };
      
      if (idempotencyKey) {
        await cacheResponse(idempotencyKey, 409, conflictResponse);
      }
      return NextResponse.json(conflictResponse, { status: 409 });
    }

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
