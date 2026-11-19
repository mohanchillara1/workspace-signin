import { and, eq, lt, sql } from 'drizzle-orm';
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

/** Takes one hit back, for a try that turned out to be fine (a correct password). */
export async function unhit(db: Db, input: { key: string; windowSeconds: number; now: Date }): Promise<void> {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(input.now.getTime() / windowMs) * windowMs);
  await db
    .update(rateHits)
    .set({ count: sql`greatest(${rateHits.count} - 1, 0)` })
    .where(and(eq(rateHits.key, input.key), eq(rateHits.windowStart, windowStart)));
}

/** How many hits a key has in the current window, without adding one. */
export async function peek(db: Db, input: { key: string; windowSeconds: number; now: Date }): Promise<number> {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(input.now.getTime() / windowMs) * windowMs);
  const [row] = await db
    .select({ count: rateHits.count })
    .from(rateHits)
    .where(and(eq(rateHits.key, input.key), eq(rateHits.windowStart, windowStart)));
  return row?.count ?? 0;
}
