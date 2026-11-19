import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeLog, kiosks } from '@/lib/db/schema';
import { kioskByToken, listKiosks, pairKiosk, unpairKiosk } from '@/lib/kiosk';
import { addMember } from '@/lib/members';
import { useTestDb } from '../setup/db';

describe('kiosk pairing', () => {
  const getDb = useTestDb();

  it('finds a paired kiosk by its token and nothing by a wrong one', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    const { id, token } = await pairKiosk(db, { name: 'Wall iPad', actorId: lead.id });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await kioskByToken(db, token))?.id).toBe(id);
    expect(await kioskByToken(db, `${token}x`)).toBeNull();
    expect(await kioskByToken(db, '')).toBeNull();
    expect(await kioskByToken(db, undefined)).toBeNull();
    const [row] = await db.select().from(kiosks).where(eq(kiosks.id, id));
    expect(row.tokenHash).not.toBe(token);
  });

  it('stops working the moment it is unpaired, and logs both steps', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    const { id, token } = await pairKiosk(db, { name: 'Spare tablet', actorId: lead.id });
    await unpairKiosk(db, id, lead.id);
    expect(await kioskByToken(db, token)).toBeNull();
    expect((await listKiosks(db)).find((k) => k.id === id)?.revokedAt).toBeInstanceOf(Date);
    const logged = await db.select().from(changeLog).where(eq(changeLog.entityId, id));
    expect(logged.map((l) => l.action).sort()).toEqual(['kiosk.pair', 'kiosk.unpair']);
  });
});
