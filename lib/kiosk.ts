import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from './db/client';
import { kiosks, type Kiosk } from './db/schema';
import { newToken, sha256 } from './ids';
import { logChange } from './log';

/**
 * "Make this the kiosk." Returns a secret that goes into a cookie on that
 * device. Only its hash is stored, so the database cannot be used to pose
 * as the kiosk.
 */
export async function pairKiosk(
  db: Db,
  input: { name: string; actorId: string },
): Promise<{ id: string; token: string }> {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Kiosk';
  const token = newToken();
  const [kiosk] = await db
    .insert(kiosks)
    .values({ name, tokenHash: sha256(token), pairedById: input.actorId })
    .returning({ id: kiosks.id });
  await logChange(db, { actorId: input.actorId, action: 'kiosk.pair', entity: 'kiosk', entityId: kiosk.id });
  return { id: kiosk.id, token };
}

export async function kioskByToken(db: Db, token: unknown): Promise<Kiosk | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [kiosk] = await db
    .select()
    .from(kiosks)
    .where(and(eq(kiosks.tokenHash, sha256(token)), isNull(kiosks.revokedAt)));
  if (!kiosk) return null;
  // Note that it is alive, at most once a minute.
  if (!kiosk.lastSeenAt || Date.now() - kiosk.lastSeenAt.getTime() > 60_000) {
    await db.update(kiosks).set({ lastSeenAt: new Date() }).where(eq(kiosks.id, kiosk.id));
  }
  return kiosk;
}

export async function unpairKiosk(db: Db, id: string, actorId: string): Promise<void> {
  const changed = await db
    .update(kiosks)
    .set({ revokedAt: new Date() })
    .where(and(eq(kiosks.id, id), isNull(kiosks.revokedAt)))
    .returning({ id: kiosks.id });
  if (changed.length === 1) {
    await logChange(db, { actorId, action: 'kiosk.unpair', entity: 'kiosk', entityId: id });
  }
}

export async function listKiosks(db: Db): Promise<Kiosk[]> {
  return db.select().from(kiosks).orderBy(desc(kiosks.pairedAt));
}
