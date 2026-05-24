import prisma from '@/lib/db';
import { notFound } from 'next/navigation';
import CheckoutClient from './checkout-client';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }> | { id: string };
}

export default async function CheckoutPage(props: Props) {
  // Await params object for compatibility with Next.js 15+
  const resolvedParams = 'then' in props.params ? await props.params : props.params;
  const { id } = resolvedParams;

  // Run lazy cleanup first to ensure status accuracy
  await cleanupExpiredReservations();

  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: {
      product: true,
      warehouse: true,
    },
  });

  if (!reservation) {
    notFound();
  }

  const serializedReservation = {
    id: reservation.id,
    productId: reservation.productId,
    productName: reservation.product.name,
    warehouseId: reservation.warehouseId,
    warehouseName: reservation.warehouse.name,
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
  };

  return <CheckoutClient reservation={serializedReservation} />;
}
