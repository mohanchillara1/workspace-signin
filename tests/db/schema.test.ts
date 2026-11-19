import { describe, expect, it } from 'vitest';
import { attendance, members } from '@/lib/db/schema';
import { newPageKey, newScanCode } from '@/lib/ids';
import { useTestDb } from '../setup/db';

describe('schema', () => {
  const getDb = useTestDb();

  it('refuses a second attendance row for one member on one day', async () => {
    const db = getDb();
    const [member] = await db
      .insert(members)
      .values({ firstName: 'Test', lastName: 'Member A', scanCode: newScanCode(), pageKey: newPageKey() })
      .returning();
    const row = { memberId: member.id, day: '2026-11-18', firstScanAt: new Date(), source: 'kiosk' as const };
    await db.insert(attendance).values(row);
    await expect(db.insert(attendance).values(row)).rejects.toThrow();
  });
});
