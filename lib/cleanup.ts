import prisma from './db';

/**
 * Automatically identifies all PENDING reservations that have passed their expiration
 * time, transitions their status to 'RELEASED', and returns their locked quantities back
 * to the available stock pool by decrementing the 'reservedUnits' of their respective StockLevels.
 * 
 * If a Prisma Transaction client (tx) is provided, the queries will execute within that transaction.
 */
export async function cleanupExpiredReservations(tx?: any) {
  const client = tx || prisma;
  
  const now = new Date();
  
  // Find all expired pending reservations
  const expiredReservations = await client.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: {
        lte: now,
      },
    },
  });

  if (expiredReservations.length === 0) {
    return 0;
  }

  console.log(`[Lazy Cleanup] Found ${expiredReservations.length} expired reservations to release.`);

  // Release each reservation one by one to ensure stock levels are properly adjusted
  for (const reservation of expiredReservations) {
    try {
      // 1. Decrement the reservedUnits in the StockLevel
      await client.stockLevel.update({
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

      // 2. Mark the individual reservation as RELEASED
      await client.reservation.update({
        where: {
          id: reservation.id,
        },
        data: {
          status: 'RELEASED',
        },
      });
      
      console.log(`[Lazy Cleanup] Successfully released reservation: ${reservation.id}`);
    } catch (error) {
      console.error(`[Lazy Cleanup] Failed to release reservation ${reservation.id}:`, error);
    }
  }

  return expiredReservations.length;
}
