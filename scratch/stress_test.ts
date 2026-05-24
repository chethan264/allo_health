import 'dotenv/config';
import prisma from '../lib/db';

const BASE_URL = 'http://localhost:3000';

async function runStressTest() {
  console.log('=== STARTING CONCURRENCY STRESS TEST ===');

  // 1. Reset database state for the concurrency SKU: 'allo-limited-pack' in 'wh-mum-02' (Mumbai Hub)
  console.log('Resetting "allo-limited-pack" stock level in Mumbai Hub (wh-mum-02) to exactly 1 available unit...');
  
  await prisma.reservation.deleteMany({
    where: {
      productId: 'allo-limited-pack',
      warehouseId: 'wh-mum-02',
    },
  });

  await prisma.stockLevel.update({
    where: {
      productId_warehouseId: {
        productId: 'allo-limited-pack',
        warehouseId: 'wh-mum-02',
      },
    },
    data: {
      totalUnits: 1,
      reservedUnits: 0,
    },
  });

  // Clear idempotency cache to avoid collisions
  await prisma.idempotencyKey.deleteMany();

  console.log('Database state reset completed. Verifying stock level...');
  const checkStock = await prisma.stockLevel.findUnique({
    where: {
      productId_warehouseId: {
        productId: 'allo-limited-pack',
        warehouseId: 'wh-mum-02',
      },
    },
  });
  console.log(`Live stock in DB: Total=${checkStock?.totalUnits}, Reserved=${checkStock?.reservedUnits}`);

  // 2. Prepare 10 concurrent reservation requests
  console.log('\nPreparing 10 simultaneous reservation requests for the last 1 available unit...');
  
  const requests = Array.from({ length: 10 }).map((_, index) => {
    const idempotencyKey = crypto.randomUUID();
    return fetch(`${BASE_URL}/api/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        productId: 'allo-limited-pack',
        warehouseId: 'wh-mum-02',
        quantity: 1,
      }),
    });
  });

  // 3. Fire all requests concurrently
  console.log('Firing all 10 reservation requests at the same instant...');
  const responses = await Promise.all(requests);
  console.log('All concurrent requests completed. Evaluating responses...');

  let successCount = 0;
  let conflictCount = 0;
  let otherCount = 0;

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const status = response.status;
    
    let body;
    try {
      body = await response.json();
    } catch {
      body = 'Unable to parse JSON';
    }

    if (status === 201) {
      successCount++;
      console.log(`Request #${i + 1}: SUCCESS (201 Created). Reservation ID: ${body.reservation?.id}`);
    } else if (status === 409) {
      conflictCount++;
      console.log(`Request #${i + 1}: CONFLICT (409 Conflict) - Sold Out. Message: ${body.message}`);
    } else {
      otherCount++;
      console.log(`Request #${i + 1}: FAILED (Status ${status}). Error:`, body);
    }
  }

  // 4. Assert correctness
  console.log('\n=== STRESS TEST RESULTS ANALYSIS ===');
  console.log(`201 Created (Successes): ${successCount} (Expected: 1)`);
  console.log(`409 Conflict (Conflicts): ${conflictCount} (Expected: 9)`);
  if (otherCount > 0) {
    console.log(`Other Statuses: ${otherCount} (Expected: 0)`);
  }

  console.log('\nChecking final stock state in database...');
  const finalStock = await prisma.stockLevel.findUnique({
    where: {
      productId_warehouseId: {
        productId: 'allo-limited-pack',
        warehouseId: 'wh-mum-02',
      },
    },
  });
  console.log(`Final stock in DB: Total=${finalStock?.totalUnits}, Reserved=${finalStock?.reservedUnits}`);

  const activeReservations = await prisma.reservation.findMany({
    where: {
      productId: 'allo-limited-pack',
      warehouseId: 'wh-mum-02',
      status: 'PENDING',
    },
  });
  console.log(`Active pending reservations: ${activeReservations.length}`);

  let failed = false;

  if (successCount !== 1) {
    console.error(`🔴 FAILURE: Expected exactly 1 successful reservation, got ${successCount}`);
    failed = true;
  }
  if (conflictCount !== 9) {
    console.error(`🔴 FAILURE: Expected exactly 9 conflicts, got ${conflictCount}`);
    failed = true;
  }
  if (finalStock?.reservedUnits !== 1) {
    console.error(`🔴 FAILURE: Reserved units in DB should be exactly 1, but found ${finalStock?.reservedUnits}`);
    failed = true;
  }
  if (activeReservations.length !== 1) {
    console.error(`🔴 FAILURE: Expected exactly 1 active pending reservation in DB, got ${activeReservations.length}`);
    failed = true;
  }

  if (!failed) {
    console.log('\n🟢 SUCCESS: High-concurrency pessimistic locking is fully robust! No race conditions, no double-selling, and no negative inventory leaks occurred.');
    process.exit(0);
  } else {
    console.error('\n🔴 FAILURE: Stress test assertion failed.');
    process.exit(1);
  }
}

runStressTest().catch(err => {
  console.error('Fatal error during stress test execution:', err);
  process.exit(1);
});
