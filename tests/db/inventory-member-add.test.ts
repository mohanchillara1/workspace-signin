// A member adds an item the list is missing, inside one group. The people here are made up.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Member } from '@/lib/db/schema';
import { UserError } from '@/lib/errors';
import { addItem, inventoryLog, listInventory, memberAddItem, setHave } from '@/lib/inventory';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

describe('a member adds an item', () => {
  const getDb = useTestDb();
  let lead: Member;
  let member: Member;
  beforeAll(async () => {
    lead = await addMember(getDb(), { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    member = await addMember(getDb(), { firstName: 'Test', lastName: 'Member A' }, null);
  });
  const named = async (name: string) => (await listInventory(getDb())).find((item) => item.name === name);
  const logFor = async (item: string) =>
    (await inventoryLog(getDb(), { limit: 100 })).filter((row) => row.item === item).map((row) => [row.who, row.change, row.to]);

  it('puts it on the shelves in that group, with the count they give, and the log names them', async () => {
    const made = await memberAddItem(getDb(), { name: '  Zip   ties ', category: 'Hardware', count: 40 }, member.id);
    expect(made.brought).toBe(false);
    const item = await named('Zip ties');
    expect(item).toMatchObject({ category: 'Hardware', count: 40, have: true });
    // Newest first: the count, then the item itself.
    expect(await logFor('Zip ties')).toEqual([
      ['Test Member A', 'count', 40],
      ['Test Member A', 'added', null],
    ]);
    // With no count it is "not counted yet", as a lead's would be.
    await memberAddItem(getDb(), { name: 'Velcro', category: 'Hardware' }, member.id);
    expect((await named('Velcro'))?.count).toBeNull();
  });

  it('refuses an item already on the shelves, in any case, and a bad name or group', async () => {
    await addItem(getDb(), { name: 'Cable ties', category: 'Hardware' }, lead.id);
    await expect(memberAddItem(getDb(), { name: 'cable TIES', category: 'Hardware' }, member.id)).rejects.toThrow(UserError);
    await expect(memberAddItem(getDb(), { name: '   ', category: 'Hardware' }, member.id)).rejects.toThrow(UserError);
    await expect(memberAddItem(getDb(), { name: 'Thing', category: 'Not a group' }, member.id)).rejects.toThrow(UserError);
    await expect(memberAddItem(getDb(), { name: 'Thing', category: 'Hardware', count: -1 }, member.id)).rejects.toThrow(UserError);
    expect(await named('Thing')).toBeUndefined();
  });

  it('brings back an item a lead set aside, instead of making it twice', async () => {
    const aside = await addItem(getDb(), { name: 'Spare gearbox', category: 'Drivetrain and mechanical' }, lead.id);
    await setHave(getDb(), aside.id, false, lead.id);
    const back = await memberAddItem(getDb(), { name: 'spare gearbox', category: 'Hardware', count: 2 }, member.id);
    expect(back).toEqual({ id: aside.id, brought: true });
    // Its own group and name stay; it is on the shelves again, with their count.
    expect(await named('Spare gearbox')).toMatchObject({ category: 'Drivetrain and mechanical', have: true, count: 2 });
    expect((await listInventory(getDb())).filter((item) => item.name.toLowerCase() === 'spare gearbox')).toHaveLength(1);
    expect(await logFor('Spare gearbox')).toEqual([
      ['Test Member A', 'count', 2],
      ['Test Member A', 'back', null],
      ['Test Lead', 'aside', null],
      ['Test Lead', 'added', null],
    ]);
  });

  it('is refused to someone switched off', async () => {
    const gone = await addMember(getDb(), { firstName: 'Test', lastName: 'Member Gone' }, null);
    await setActive(getDb(), gone.id, false, lead.id);
    await expect(memberAddItem(getDb(), { name: 'Not added', category: 'Tools' }, gone.id)).rejects.toThrow(UserError);
    expect(await named('Not added')).toBeUndefined();
  });
});
