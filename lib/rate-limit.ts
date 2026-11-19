import { lt, sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { rateHits } from './db/schema';

/**
 * Counts one hit against a key in a fixed window. The count lives in the
 * database, so it holds across server instances. One atomic upsert.
 */
export async function hit(
  db: Db,
  input: { key: string; limit: number; windowSeconds: number; now: Date },
): Promise<{ allowed: boolean }> {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(input.now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateHits)
    .values({ key: input.key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateHits.key, rateHits.windowStart],
      set: { count: sql`${rateHits.count} + 1` },
    })
    .returning({ count: rateHits.count });
  // Now and then, clear out windows that ended more than a day ago.
  if (Math.random() < 0.01) {
    await db.delete(rateHits).where(lt(rateHits.windowStart, new Date(input.now.getTime() - 86_400_000)));
  }
  return { allowed: row.count <= input.limit };
}
