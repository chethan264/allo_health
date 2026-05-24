import { NextResponse } from 'next/server';
import prisma, { withDbRetry } from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const formattedProducts = await withDbRetry(async () => {
      // 1. Run lazy cleanup of expired reservations to ensure returned stock data is 100% accurate
      await cleanupExpiredReservations();

      // 2. Fetch all products with their stock levels and warehouse details
      const products = await prisma.product.findMany({
        include: {
          stockLevels: {
            include: {
              warehouse: true,
            },
          },
        },
        orderBy: {
          name: 'asc',
        },
      });

      // 3. Format the data for a premium frontend experience, computing available units
      return products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        stockLevels: product.stockLevels.map((sl) => ({
          warehouseId: sl.warehouseId,
          warehouseName: sl.warehouse.name,
          totalUnits: sl.totalUnits,
          reservedUnits: sl.reservedUnits,
          availableUnits: Math.max(0, sl.totalUnits - sl.reservedUnits),
        })),
      }));
    });

    return NextResponse.json(formattedProducts);
  } catch (error) {
    console.error('GET /api/products error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
