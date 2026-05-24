import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';
import { getCachedResponse, cacheResponse } from '@/lib/idempotency';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  // Await the params object to ensure compatibility with Next.js 15+ App Router dynamic route parameters
  const resolvedParams = 'then' in props.params ? await props.params : props.params;
  const { id } = resolvedParams;

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
    // 2. Perform a lazy cleanup on read/write to handle other expired reservations first
    await cleanupExpiredReservations();

    // 3. Confirm the reservation inside a transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx: any) => {
      // Find the specific reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        throw new Error('NOT_FOUND');
      }

      if (reservation.status === 'CONFIRMED') {
        return { status: 'ALREADY_CONFIRMED', reservation };
      }

      if (reservation.status === 'RELEASED') {
        throw new Error('EXPIRED');
      }

      // Check if the pending hold has expired
      const now = new Date();
      if (reservation.expiresAt < now) {
        // If expired, release the hold immediately (transition status and release stock levels)
        await tx.stockLevel.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId,
            },
          },
          data: {
            reservedUnits: {
              decrement: reservation.quantity,
            },
          },
        });

        await tx.reservation.update({
          where: { id },
          data: {
            status: 'RELEASED',
          },
        });

        throw new Error('EXPIRED');
      }

      // If valid, confirm it: permanently decrement totalUnits and release reservedUnits
      await tx.stockLevel.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          totalUnits: {
            decrement: reservation.quantity,
          },
          reservedUnits: {
            decrement: reservation.quantity,
          },
        },
      });

      const confirmedReservation = await tx.reservation.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
        },
      });

      return { status: 'SUCCESS', reservation: confirmedReservation };
    });

    const successResponse = {
      message: result.status === 'ALREADY_CONFIRMED' 
        ? 'Reservation was already confirmed' 
        : 'Reservation confirmed successfully and stock permanently decremented.',
      reservation: result.reservation,
    };

    if (idempotencyKey) {
      await cacheResponse(idempotencyKey, 200, successResponse);
    }

    return NextResponse.json(successResponse, { status: 200 });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '';
    console.error(`POST /api/reservations/${id}/confirm error:`, errorMessage || error);

    if (errorMessage === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'Not Found', message: 'Reservation not found.' },
        { status: 404 }
      );
    }

    if (errorMessage === 'EXPIRED') {
      const expiredResponse = {
        error: 'Gone',
        message: 'This reservation has expired and cannot be confirmed. The units have been returned to stock.',
      };
      
      if (idempotencyKey) {
        await cacheResponse(idempotencyKey, 410, expiredResponse);
      }
      return NextResponse.json(expiredResponse, { status: 410 });
    }

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
