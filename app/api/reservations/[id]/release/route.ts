import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  // Await the params object to ensure compatibility with Next.js 15+ App Router dynamic route parameters
  const resolvedParams = 'then' in props.params ? await props.params : props.params;
  const { id } = resolvedParams;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // Find the specific reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        throw new Error('NOT_FOUND');
      }

      if (reservation.status === 'RELEASED') {
        return { status: 'ALREADY_RELEASED', reservation };
      }

      if (reservation.status === 'CONFIRMED') {
        throw new Error('ALREADY_CONFIRMED');
      }

      // Decrement the reservedUnits in the StockLevel
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

      // Update the reservation status to RELEASED
      const releasedReservation = await tx.reservation.update({
        where: { id },
        data: {
          status: 'RELEASED',
        },
      });

      return { status: 'SUCCESS', reservation: releasedReservation };
    });

    return NextResponse.json({
      message: result.status === 'ALREADY_RELEASED'
        ? 'Reservation was already released'
        : 'Reservation successfully released early. Units returned to available stock.',
      reservation: result.reservation,
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '';
    console.error(`POST /api/reservations/${id}/release error:`, errorMessage || error);

    if (errorMessage === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'Not Found', message: 'Reservation not found.' },
        { status: 404 }
      );
    }

    if (errorMessage === 'ALREADY_CONFIRMED') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Cannot release a reservation that has already been confirmed.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
