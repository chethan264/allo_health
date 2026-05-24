# Allo Health Inventory Reservation & Checkout Engine

A high-concurrency, multi-warehouse inventory reservation and checkout platform built with **Next.js (App Router)**, **TypeScript**, **Prisma (v7)**, and **PostgreSQL**. 

This platform employs database-level **Pessimistic Locking (`SELECT ... FOR UPDATE`)** inside atomic transactions to guarantee thread safety, zero stock leaks, and zero double-selling under intense, simultaneous flash-sale traffic.

---

## 📋 Assignment Deliverables Checklist

To make review as simple as possible, here are the direct links to the three required assignment points:
1. [**Section 1: How to Run the App Locally (Env Vars, Migrations, Seed)**](#1-how-to-run-the-app-locally-env-vars-migrations-seed)
2. [**Section 2: How the Expiry Mechanism Works in Production**](#2-how-the-expiry-mechanism-works-in-production)
3. [**Section 3: Trade-offs Made & Things We'd Do Differently with More Time**](#3-trade-offs-made--things-wed-do-differently-with-more-time)

---

## 1. How to Run the App Locally (Env Vars, Migrations, Seed)

Follow these steps to configure your environment, synchronize the PostgreSQL schema, seed the catalog, and launch the platform.

### Prerequisites
* **Node.js**: v20 or later
* **PostgreSQL**: A hosted database instance (e.g., Neon, Supabase) or local instance.

### Step 1: Environment Configuration
Create a `.env` file in the root directory and specify your connection string:
```env
# Hosted or Local PostgreSQL Connection URL
DATABASE_URL="postgresql://neondb_owner:npg_sd9aSLC8bjVU@ep-mute-hill-ap7hv3ov.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&connect_timeout=30"

# Optional Secret to authorize Cron triggers in production
CRON_SECRET="your-super-secure-cron-token"
```

### Step 2: Install Dependencies
Install the Next.js and Prisma package dependencies:
```bash
npm install
```

### Step 3: Apply Migrations & Schema
Synchronize the PostgreSQL cloud database with our Prisma Schema model configurations:
```bash
npx prisma db push
```

### Step 4: Seed the Database
Seed the tables with initial catalogs, fulfillment centers, and a special low-stock validation SKU (`allo-limited-pack`, exactly 1 unit in Mumbai Logistics Hub):
```bash
npx tsx prisma/seed.ts
```
*(Note: We integrated `dotenv` directly into the seed script so environment variables load seamlessly when run directly via the terminal).*

### Step 5: Start the Application
Run the Next.js Turbopack-powered development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser to explore the premium wellness storefront catalog and live interactive checkout!

---

## 2. How the Expiry Mechanism Works in Production

To prevent inventory depletion from abandoned checkouts (since statistically 80% of carts are abandoned), the system automatically expires reservation holds after **10 minutes**. The reclaim strategy is robustly **two-pronged**:

### 1. Lazy Cleanup on Read/Write (Instant Consistency)
Relying *only* on a background cron has a race condition: a shopper could try to buy an item that is locked by an expired hold because the cron hasn't executed yet, facing an artificial out-of-stock indicator.
* **Our Solution**: Every time stock catalogs are retrieved (`GET /api/products`) or new reservations are attempted, the server queries the database for expired pending holds inside the transaction block.
* It transitions their status to `RELEASED` and atomically decrements `reservedUnits` in their respective `StockLevel` rows in one atomic transaction, guaranteeing instant stock availability.

### 2. Scheduled Background Cron Worker
An endpoint `/api/cron/cleanup` is provided. This can be bound to **Vercel Crons**, **Upstash Schedulers**, or a standard periodic background worker to batch-release abandoned holds and keep the database clean.

### 3. Serverless Database Resilience (`withDbRetry`)
Serverless databases (like **Neon PostgreSQL**) spin down when idle to conserve resources. During cold starts, the database wake-up delay can cause standard query connections to time out.
* **Our Solution**: We implemented a `withDbRetry` helper in `lib/db.ts` that catches `P1001` (DatabaseNotReachable) or connection errors, waits 1.5s, and **automatically retries queries up to 3 times** before returning an error. This keeps storefront catalog reads 100% resilient.

---

## 3. Trade-offs Made & Things We'd Do Differently with More Time

### A. Trade-offs Made

#### 1. Database Pessimistic vs. Optimistic Locking
* *Optimistic Locking* (version column tracking) is excellent for low-contention environments. However, in high-concurrency reservation scenarios, optimistic locking leads to extremely high write-skew transaction failures, wasting database CPU cycles and slowing response times.
* *Pessimistic Locking* (`SELECT ... FOR UPDATE`) locks the specific `StockLevel` row immediately at read-time, queuing concurrent threads at the database level. This guarantees that stock counts are evaluated sequentially, eliminating double-selling and keeping database execution predictable under peak stress.

#### 2. Prisma 7 WebAssembly Compatibility
* Prisma 7 removes default native engines to improve cold starts and bundle sizes. We configured standard `pg` Pool adapters and the `@prisma/adapter-pg` driver adapter to ensure seamless execution on hosted serverless PostgreSQL engines like Neon, avoiding static page compilation crashes.

#### 3. Real-time Lazy Reclaims vs. Batch Recyclers
* We chose to execute lazy cleanup on read/write inside database transactions. While this adds a minor latency overhead on catalog reads, it completely eliminates artificial catalog exhaustion and ensures microsecond-accurate stock levels.

### B. Things We'd Do Differently with More Time (Scale Roadmap)

If deploying this platform to support a global e-commerce catalog with millions of active checkouts:

1. **Distributed Memory Locking (Redis / Redlock)**:
   * *Current*: Row locks are acquired directly in PostgreSQL. While bulletproof, this consumes database threads and can lead to DB bottlenecks under extreme traffic.
   * *Future*: Acquire temporary holds inside a distributed, in-memory cache like Redis using the **Redlock** algorithm. Shoppers secure locks in sub-milliseconds, offloading all locking contention CPU cycles from our primary database.
2. **Asynchronous Checkout Queuing**:
   * *Current*: Checkouts are processed synchronously.
   * *Future*: Introduce a message broker (e.g., BullMQ, RabbitMQ, or AWS SQS). When a user confirms a purchase, their payment is processed asynchronously. The user is immediately returned a "Processing..." status, protecting the database from traffic spikes.
3. **Database Read-Replicas**:
   * Implement a master-replica database layout. Route all high-frequency read operations (`GET /api/products`) to read-replicas, and restrict the primary writer master database strictly to write-row locks (`POST /api/reservations`), drastically increasing read capacity.

---

## ⚡ Concurrency Safety & Core Architecture

Here is the exact sequence of how our pessimistic locking engine prevents race conditions when concurrent shoppers attempt to secure the last unit:

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Shopper A
    actor Bob as Shopper B
    participant API as POST /api/reservations
    participant DB as Postgres (FOR UPDATE)
    
    rect rgb(20, 20, 30)
    note right of Alice: Alice & Bob claim last 1 unit concurrently
    Alice->>API: Reserve 1 Unit (Idempotency Key A)
    Bob->>API: Reserve 1 Unit (Idempotency Key B)
    end
    
    API->>DB: Alice: SELECT * FROM "StockLevel" WHERE ... FOR UPDATE
    note right of DB: DB locks StockLevel row for Alice's transaction.
    
    API->>DB: Bob: SELECT * FROM "StockLevel" WHERE ... FOR UPDATE
    note right of DB: Bob's transaction is suspended/queued by PostgreSQL.
    
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

---

## 🧪 Concurrency Stress Testing

We built a dedicated concurrent assertion suite inside `scratch/stress_test.ts` to validate absolute correctness.
1. Start the development server (`npm run dev`).
2. Run the stress script:
   ```bash
   npx tsx scratch/stress_test.ts
   ```

**What the stress test does:**
* Triggers the cron cleanups to restore Mumbai Hub's stock of `allo-limited-pack` to exactly **1 unit**.
* Fires **10 simultaneous reservation requests** in a single asynchronous instant.
* Verifies that **exactly 1 request** succeeds with `201 Created` and **exactly 9 requests** receive `409 Conflict`.
* Asserts that no double-selling or negative inventory leaks occurred in the database.

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
└── scratch/
    └── stress_test.ts                 # Concurrency stress test assertion suite
```

- **Framework**: Next.js App Router (16.2.6) with React 19.
- **Styling**: Tailwind CSS v4 & custom glassmorphic properties inside `app/globals.css`.
- **Database ORM**: Prisma (7.8.0) using `@prisma/adapter-pg` driver adapter.
- **Validation**: Zod (v4).
