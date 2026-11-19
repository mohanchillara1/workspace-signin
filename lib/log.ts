import type { Db } from './db/client';
import { changeLog } from './db/schema';

/** Records who changed what. Never put a scan code, key or password in detail. */
export async function logChange(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(changeLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    detail: entry.detail ?? {},
  });
}
