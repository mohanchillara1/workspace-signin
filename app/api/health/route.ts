import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';

// The kiosk asks this to find out whether it can sign people in. That needs
// the database as well as the network, so this asks the database too. It
// says nothing else.
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'cache-control': 'no-store' };
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
