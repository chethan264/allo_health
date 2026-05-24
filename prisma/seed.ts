import 'dotenv/config';
import prisma from '../lib/db';

async function main() {
  console.log('Seeding started...');

  // 1. Clear existing data in reverse dependency order
  await prisma.idempotencyKey.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.product.deleteMany();
  await prisma.warehouse.deleteMany();

  console.log('Cleared existing database tables.');

  // 2. Create Products
  const products = [
    {
      id: 'allo-vit-d3',
      name: 'Allo Vitamin D3 Boost',
      description: 'High-absorption daily Vitamin D3 supplement for bone health and immunity support.',
      price: 499.0,
    },
    {
      id: 'allo-ashwagandha',
      name: 'Pure Ashwagandha KSM-66',
      description: 'Premium organic Ashwagandha extract for stress relief, cortisol regulation, and energy.',
      price: 799.0,
    },
    {
      id: 'allo-sleep-relax',
      name: 'Allo Sleep & Relax Melatonin',
      description: 'Natural sleep aid formula featuring melatonin, L-theanine, and chamomile extract.',
      price: 599.0,
    },
    {
      id: 'allo-multivitamin',
      name: 'Daily Vitality Multivitamin',
      description: 'Comprehensive spectrum of 24 essential vitamins and minerals for daily wellness.',
      price: 699.0,
    },
    {
      id: 'allo-limited-pack',
      name: 'Limited Edition Allo Health Pack',
      description: 'Exclusive bundle containing premium nutrition essentials. Super low stock!',
      price: 1999.0,
    },
  ];

  for (const product of products) {
    await prisma.product.create({
      data: product,
    });
  }
  console.log(`Created ${products.length} products.`);

  // 3. Create Warehouses
  const warehouses = [
    {
      id: 'wh-blr-01',
      name: 'Bengaluru Fulfillment Center',
      location: 'Whitefield, Bengaluru, Karnataka',
    },
    {
      id: 'wh-mum-02',
      name: 'Mumbai Logistics Hub',
      location: 'Bhiwandi, Mumbai, Maharashtra',
    },
    {
      id: 'wh-del-03',
      name: 'Delhi NCR Warehouse',
      location: 'Udyog Vihar, Gurugram, Haryana',
    },
  ];

  for (const warehouse of warehouses) {
    await prisma.warehouse.create({
      data: warehouse,
    });
  }
  console.log(`Created ${warehouses.length} warehouses.`);

  // 4. Create Stock Levels
  const stockLevels = [
    // Allo Vitamin D3
    { productId: 'allo-vit-d3', warehouseId: 'wh-blr-01', totalUnits: 120 },
    { productId: 'allo-vit-d3', warehouseId: 'wh-mum-02', totalUnits: 45 },
    // Pure Ashwagandha
    { productId: 'allo-ashwagandha', warehouseId: 'wh-blr-01', totalUnits: 250 },
    { productId: 'allo-ashwagandha', warehouseId: 'wh-del-03', totalUnits: 80 },
    // Sleep & Relax
    { productId: 'allo-sleep-relax', warehouseId: 'wh-mum-02', totalUnits: 60 },
    { productId: 'allo-sleep-relax', warehouseId: 'wh-del-03', totalUnits: 150 },
    // Daily Multivitamin
    { productId: 'allo-multivitamin', warehouseId: 'wh-blr-01', totalUnits: 300 },
    { productId: 'allo-multivitamin', warehouseId: 'wh-mum-02', totalUnits: 180 },
    { productId: 'allo-multivitamin', warehouseId: 'wh-del-03', totalUnits: 110 },
    // Limited Pack (Low Stock for testing concurrency & race conditions)
    { productId: 'allo-limited-pack', warehouseId: 'wh-blr-01', totalUnits: 2 },
    { productId: 'allo-limited-pack', warehouseId: 'wh-mum-02', totalUnits: 1 },
  ];

  for (const stock of stockLevels) {
    await prisma.stockLevel.create({
      data: {
        productId: stock.productId,
        warehouseId: stock.warehouseId,
        totalUnits: stock.totalUnits,
        reservedUnits: 0,
      },
    });
  }
  console.log(`Created ${stockLevels.length} stock level configurations.`);
  console.log('Seeding successfully completed!');
}

main()
  .catch((e) => {
    console.error('Error during database seed execution:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
