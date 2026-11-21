// A member takes an item off the list ("We don't have this"). It is set aside, never deleted. The people here are made up.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { inventoryItems, inventoryPhotos, type Member } from '@/lib/db/schema';
import { UserError } from '@/lib/errors';
import { addItem, inventoryLog, listInventory, memberAddItem, memberSetAside, setPhoto } from '@/lib/inventory';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

// A one-pixel PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('a member sets an item aside', () => {
  const getDb = useTestDb();
  let lead: Member;
  let member: Member;
  beforeAll(async () => {
    lead = await addMember(getDb(), { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    member = await addMember(getDb(), { firstName: 'Test', lastName: 'Member A' }, null);
  });
  const named = async (name: string) => (await listInventory(getDb())).find((item) => item.name === name);

  it('takes it off the shelves and keeps the row, its count and its photo; the log names the member', async () => {
    const item = await addItem(getDb(), { name: 'Spare bearings', category: 'Hardware', count: 12 }, lead.id);
    await setPhoto(getDb(), item.id, { mime: 'image/png', base64: PIXEL }, lead.id);
    await memberSetAside(getDb(), item.id, member.id);
    expect(await named('Spare bearings')).toMatchObject({ have: false, count: 12 });
    expect(await getDb().select().from(inventoryItems).where(eq(inventoryItems.id, item.id))).toHaveLength(1);
    expect(await getDb().select().from(inventoryPhotos).where(eq(inventoryPhotos.itemId, item.id))).toHaveLength(1);
    const log = (await inventoryLog(getDb(), { limit: 100 })).filter((row) => row.item === 'Spare bearings');
    expect(log[0]).toMatchObject({ who: 'Test Member A', change: 'aside' });
  });

  it('refuses an item already set aside, one that is not there, and someone switched off', async () => {
    const item = await addItem(getDb(), { name: 'Old cable', category: 'Wire and connectors' }, lead.id);
    await memberSetAside(getDb(), item.id, member.id);
    await expect(memberSetAside(getDb(), item.id, member.id)).rejects.toThrow(UserError);
    await expect(memberSetAside(getDb(), '00000000-0000-4000-8000-000000000000', member.id)).rejects.toThrow(UserError);
    const other = await addItem(getDb(), { name: 'Kept cable', category: 'Wire and connectors' }, lead.id);
    const gone = await addMember(getDb(), { firstName: 'Test', lastName: 'Member Gone' }, null);
    await setActive(getDb(), gone.id, false, lead.id);
    await expect(memberSetAside(getDb(), other.id, gone.id)).rejects.toThrow(UserError);
    expect((await named('Kept cable'))?.have).toBe(true);
  });

  it('comes back when anyone adds that name again', async () => {
    const item = await addItem(getDb(), { name: 'Zip ties, long', category: 'Hardware', count: 3 }, lead.id);
    await memberSetAside(getDb(), item.id, member.id);
    const back = await memberAddItem(getDb(), { name: 'zip ties, long', category: 'Hardware' }, member.id);
    expect(back).toEqual({ id: item.id, brought: true });
    expect(await named('Zip ties, long')).toMatchObject({ have: true, count: 3 });
  });
});
