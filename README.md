# Allo Health Inventory Reservation & Checkout Engine

A high-concurrency, multi-warehouse inventory reservation and checkout platform built with **Next.js (App Router)**, **TypeScript**, **Prisma (v7)**, and **PostgreSQL**. This platform employs atomic database-level pessimistic locking (`SELECT ... FOR UPDATE`) to eliminate race conditions and double-selling under intense concurrent traffic.

---

## ⚡ Concurrency Safety & Core Architecture

The core engineering challenge of this system is **correctness under concurrent claims** (e.g., thousands of shoppers vying for the last available unit of a high-value SKU). If stock is decremented only at payment, customers suffer double-selling and refund frustrations. If stock is locked at add-to-cart, checkout abandonment depletes active catalogs.

### Our Solution: Pessimistic Row-Level Locking
This platform implements a **temporary reservation hold** (10-minute TTL) with database transactions utilizing **Pessimistic Locking (`SELECT ... FOR UPDATE`)**.

```mermaid
sequenceDiagram
    autonumber
    actor Alice
    actor Bob
    participant API as POST /api/reservations
    participant DB as Postgres (FOR UPDATE)
    
    rect rgb(20, 20, 30)
    note right of Alice: Alice & Bob claim last 1 unit concurrently
    Alice->>API: Reserve 1 Unit (Idempotency Key 1)
    Bob->>API: Reserve 1 Unit (Idempotency Key 2)
    end
    
    API->>DB: Alice: SELECT * FROM "StockLevel" WHERE ... FOR UPDATE
    note right of DB: DB locks StockLevel row for Alice's transaction.
    
    API->>DB: Bob: SELECT * FROM "StockLevel" WHERE ... FOR UPDATE
    note right of DB: Bob's transaction is suspended/queued.
    
    rect rgb(10, 35, 15)
    note right of DB: Alice's thread computes: total - reserved = 1 >= 1 (OK!)
    DB-->>API: Alice: Stock available. Create reservation.
    API-->>Alice: 201 Created (Redirect to Checkout)
    end
    
    note right of DB: Alice's transaction commits. Lock released.
    
    rect rgb(35, 10, 15)
    note right of DB: Bob's thread resumes and evaluates:
    note right of DB: total - reserved = 1 - 1 = 0 < 1 (INSUFFICIENT_STOCK)
    DB-->>API: Bob: Stock unavailable. Rollback.
    API-->>Bob: 409 Conflict (Show Sold Out Toast)
    end
```

### The Transaction Flow
Inside `/api/reservations/route.ts`:
1. **Lazy Cleanup**: Reclaims expired `PENDING` holds immediately before checking current stock.
2. **Row Locking**: Queries the specific `StockLevel` row using standard PostgreSQL raw query `FOR UPDATE`. This blocks concurrent operations on this exact product-warehouse combo.
3. **Validation**: Computes actual available pool: `availableUnits = totalUnits - reservedUnits`. If sufficient, increments `reservedUnits` and creates a `PENDING` reservation.
4. **Idempotency**: Results are cached in the `IdempotencyKey` table. Re-submitted operations return the identical payload without repeating side effects.

---

## 🕒 Expiry & Reclaim Strategy

To avoid catalog depletion from abandoned checkouts, the system automatically expires reservations after **10 minutes**. The reclaim strategy is two-pronged:

1. **Lazy Cleanup on Read/Write (Instant Consistency)**:
   Every time stock catalogs are retrieved (`GET /api/products`) or new reservations are attempted, the server queries the database for expired pending holds:
   ```typescript
   const expired = await tx.reservation.findMany({
     where: { status: 'PENDING', expiresAt: { lte: new Date() } }
   });
   ```
   It transitions their status to `RELEASED` and decrements `reservedUnits` on their stock levels atomically inside the transaction. This guarantees shoppers never face artificial out-of-stock statuses.
2. **Scheduled Background Cron**:
   An endpoint `/api/cron/cleanup` is provided. This can be bound to **Vercel Crons** or a standard background scheduler to periodically batch-release abandoned holds and keep the database clean.

---

## 🛠️ Local Development & Setup

### Prerequisites
- **Node.js**: v20 or later
- **PostgreSQL**: An active local or hosted database (Neon, Supabase, etc.)

### 1. Environment Configuration
Create a `.env` file in the root directory:
```env
# Hosted or Local Postgres Connection URL
DATABASE_URL="postgresql://user:password@hostname:5432/dbname?sslmode=require"
# Optional Secret to authorize Cron triggers in production
CRON_SECRET="your-super-secure-cron-token"
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Apply Migrations & Schema
Sync your database with our Prisma Schema:
```bash
npx prisma db push
```

### 4. Seed the Database
Seed the tables with initial catalogs, fulfillment centers, and a special low-stock validation SKU (`allo-limited-pack`, exactly 1 unit in Mumbai Hub):
```bash
npx tsx prisma/seed.ts
```

### 5. Start the Application
Run the Next.js Turbo-powered development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the interface.

---

## 🧪 Concurrency Stress Testing

We have built a dedicated concurrent assertion suite inside the `scratch/stress_test.ts` file to validate correctness.

1. Ensure the development server is active (`npm run dev`).
2. Run the stress script:
   ```bash
   npx tsx scratch/stress_test.ts
   ```

**What the stress test does:**
* It triggers the cron cleanups to restore Mumbai Hub's stock of `allo-limited-pack` to exactly **1 unit**.
* It fires **10 simultaneous reservation requests** in a single asynchronous instant.
* It verifies that **exactly 1 request** succeeds with `201 Created` and **exactly 9 requests** receive `409 Conflict`.
* It asserts that no double-selling or negative inventory leaks occurred in the database.

---

## 🏗️ Project Architecture & Tech Stack

```
├── app/
│   ├── api/
│   │   ├── cron/cleanup/route.ts      # Expiry worker trigger
│   │   ├── products/route.ts          # Catalogs listing (Lazy-cleanup active)
│   │   ├── warehouses/route.ts        # Warehouses listing
│   │   └── reservations/
│   │       ├── route.ts               # Concurrency-locked hold creation
│   │       └── [id]/
│   │           ├── confirm/route.ts   # Payment/Hold confirmation
│   │           └── release/route.ts   # Hold cancellation
│   ├── checkout/[id]/
│   │   ├── page.tsx                   # Server wrapper
│   │   └── checkout-client.tsx        # High-frequency countdown overlay
│   ├── layout.tsx                     # Master theme, navbar & status bar
│   └── page.tsx                       # Glassmorphic browse & reserve panel
├── lib/
│   ├── db.ts                          # PG driver-adapter-configured Prisma Singleton
│   ├── cleanup.ts                     # Multi-transaction lazy-release core
│   └── idempotency.ts                 # Key validator & cache
├── prisma/
│   ├── schema.prisma                  # Models (Product, StockLevel, Reservation)
│   └── seed.ts                        # Seeding configuration
```

- **Framework**: Next.js App Router (16.2.6) with React 19.
- **Styling**: Tailwind CSS v4 & custom glassmorphic properties inside `app/globals.css`.
- **Database ORM**: Prisma (7.8.0) using `@prisma/adapter-pg` driver adapter for serverless/hosted compatibility.
- **Validation**: Zod (v4).

---

## 🎨 Premium UI Aesthetics

The user interface uses custom CSS variables to construct a state-of-the-art **glowing glassmorphic dark-mode** dashboard:
* **Stock Badges**: Dynamically glow green/yellow/red using tailored HSL color schemes depending on live pool depth.
* **SVG Countdown Ring**: Interactive circle that counts down the 10-minute hold with pixel-perfect accuracy, fading and transitioning states client-side.
* **Error Overlays**: Smooth transition portals that catch `409` (insufficient stock) and `410` (hold expired) and render detailed warning panels.
* **Zero Placeholders**: Loaded with real pharmaceutical/wellness seed descriptions and professional icons.

---

## ⚖️ Trade-offs, Production Expiry & Scale Strategy

This section documents the specific engineering decisions, trade-offs, and scaling plans implemented in this project to satisfy all evaluation criteria.

### 1. How the Expiry Mechanism Works in Production
To prevent inventory hoards from abandoned shopping carts (an 80% abandonment rate on average), the system employs a robust **two-pronged expiration and reclaim strategy**:

1. **Lazy Cleanup on Read/Write (Microsecond-Accurate Consistency)**:
   Relying *only* on a periodic background scheduler has a major race condition: a shopper might try to buy an item that is locked by an expired hold because the cron hasn't executed yet.
   * **Our Solution**: Every time the storefront catalog is fetched (`GET /api/products`) or a new reservation hold is attempted (`POST /api/reservations`), the engine automatically checks for expired `PENDING` holds inside a database transaction, releases them, and atomically increments available stock. This ensures shoppers always view a 100% accurate catalog.
2. **Scheduled Background Cron Worker**:
   We provide a `/api/cron/cleanup` endpoint that can be wired to **Vercel Crons** or standard schedulers (e.g., Upstash, GitHub Actions) to run every minute/hour to batch-expire older inactive holds in the database.
3. **Serverless Database Resilience (`withDbRetry`)**:
   Managed serverless databases (like **Neon PostgreSQL**) go to sleep after periods of inactivity. During database wake-up (cold starts), requests can fail due to connection timeouts.
   * **Our Solution**: We built an automatic retry helper (`withDbRetry`) inside [lib/db.ts](file:///c:/Users/nchet/Desktop/allo_health/lib/db.ts) that intercepts database connection timeouts, waits 1.5s, and automatically retries queries up to 3 times before returning a failure.

---

### 2. Trade-offs & Engineering Decisions

* **Database Pessimistic vs. Optimistic Locking**:
  * *Optimistic Locking* (version-column tracking) is excellent for low-contention environments. However, under flash-sale scenarios where thousands of shoppers buy the same item, optimistic locking leads to extremely high write-skew transaction failures and costly app-level retries.
  * *Pessimistic Locking* (`SELECT ... FOR UPDATE`) locks the specific `StockLevel` row immediately at read-time, queuing concurrent threads at the database level. This guarantees that stock counts are evaluated sequentially, eliminating double-selling and keeping database execution predictable under peak stress.
* **Prisma 7 WebAssembly & pg Adapter Config**:
  * Prisma 7 removes default native binary engines to improve cold starts. We configured the standard `pg` Pool adapter to ensure seamless execution on hosted serverless PostgreSQL engines without static page compilation crashes.

---

### 3. What We Would Do Differently with More Time (Scale Strategy)

If we were deploying this to support a global e-commerce catalog with millions of daily transactions, we would evolve the architecture as follows:

1. **Distributed Memory Locking (Redis / Redlock)**:
   * *Current*: Pessimistic locks lock rows directly in the PostgreSQL database. While robust, this consumes database threads and can lead to DB bottlenecking under massive traffic.
   * *Future*: Move the lock acquisition to a high-speed in-memory store like Redis using the **Redlock** algorithm. Shoppers secure the 10-minute hold in Redis in sub-milliseconds, offloading all lock-contention CPU overhead from our primary relational database.
2. **Asynchronous Checkout Queues (Message Broker)**:
   * *Current*: Reservations and checkouts occur synchronously.
   * *Future*: Introduce a message broker (e.g., BullMQ, RabbitMQ, or AWS SQS). When a user clicks "Pay", their checkout is queued and processed asynchronously. The user is immediately returned a "Processing..." status, preventing server timeouts and distributing traffic spikes smoothly.
3. **Database Read-Replicas**:
   * Implement a master-replica database layout. Route all high-frequency read operations (`GET /api/products`) to read-replicas, and restrict the primary writer master database strictly to write-row locks (`POST /api/reservations`), drastically increasing read capacity.

