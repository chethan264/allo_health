import { NextResponse } from 'next/server';
import { cleanupExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Check Authorization header for security in production if configured
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const releasedCount = await cleanupExpiredReservations();
    
    return NextResponse.json({
      message: 'Cron cleanup executed successfully.',
      timestamp: new Date().toISOString(),
      releasedCount,
    });
  } catch (error) {
    console.error('POST /api/cron/cleanup error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// Support GET for testing/monitoring or simple ping-based cron triggers
export async function GET() {
  try {
    const releasedCount = await cleanupExpiredReservations();
    
    return NextResponse.json({
      message: 'Cron cleanup executed successfully via GET.',
      timestamp: new Date().toISOString(),
      releasedCount,
    });
  } catch (error) {
    console.error('GET /api/cron/cleanup error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
