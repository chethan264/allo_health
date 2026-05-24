import prisma from './db';

/**
 * Checks if the given Idempotency-Key already has a recorded response.
 * If so, returns the cached status and parsed response body.
 */
export async function getCachedResponse(key: string) {
  if (!key) return null;
  
  const record = await prisma.idempotencyKey.findUnique({
    where: { key },
  });

  if (record) {
    console.log(`[Idempotency] Cache hit for key: ${key}`);
    return {
      status: record.responseStatus,
      body: JSON.parse(record.responseBody),
    };
  }

  return null;
}

/**
 * Saves the response status and body associated with an Idempotency-Key,
 * so that subsequent retries return the exact same output.
 */
export async function cacheResponse(key: string, status: number, body: unknown) {
  if (!key) return;

  try {
    const responseBodyString = JSON.stringify(body);
    
    await prisma.idempotencyKey.upsert({
      where: { key },
      create: {
        key,
        responseStatus: status,
        responseBody: responseBodyString,
      },
      update: {
        responseStatus: status,
        responseBody: responseBodyString,
        createdAt: new Date(), // Reset TTL/timestamp
      },
    });
    
    console.log(`[Idempotency] Cached response for key: ${key}`);
  } catch (error) {
    console.error(`[Idempotency] Failed to cache response for key: ${key}`, error);
  }
}
