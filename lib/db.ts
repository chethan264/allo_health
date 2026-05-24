import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  const connectionString = process.env.DATABASE_URL || "postgresql://dummyuser:dummypassword@localhost:5432/dummydb";
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;

/**
 * Executes a database operation with automatic retries for transient connection errors
 * (e.g., serverless cold starts like Neon).
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      const errorMessage = error?.message || '';
      const errorCode = error?.code || '';
      
      const isConnectionError = 
        errorCode === 'P1001' || 
        errorCode === 'P1002' ||
        errorMessage.includes("Can't reach database server") ||
        errorMessage.includes('DatabaseNotReachable') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('connection timeout') ||
        errorMessage.includes('Connection terminated');
      
      if (isConnectionError && i < retries - 1) {
        console.warn(`[DB Retry] Connection issue encountered (attempt ${i + 1}/${retries}). Retrying in ${delayMs}ms... Error: ${errorMessage || error}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
