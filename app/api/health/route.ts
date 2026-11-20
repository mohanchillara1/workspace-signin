import { sql } from 'drizzle-orm';
import { BUILD } from '@/lib/build';
import { getDb } from '@/lib/db/client';

// The kiosk asks this to find out whether it can sign people in. That needs
// the database as well as the network, so this asks the database too. It
// says nothing else but which build of the site answered, so a kiosk that
// has been open for weeks can tell when it is out of date.
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'cache-control': 'no-store' };
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true, build: BUILD }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
