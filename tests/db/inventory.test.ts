// The team's inventory: items with a count and a picture. The people here are made up.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { changeLog, inventoryItems, type Member } from '@/lib/db/schema';
import { UserError } from '@/lib/errors';
import {
  addItem,
  addStarterList,
  changeCount,
  INVENTORY_CATEGORIES,
  inventoryLog,
  listInventory,
  membersSeeInventory,
  PHOTO_MAX_BYTES,
  photoOf,
  setCount,
  setHave,
  setMembersSeeInventory,
  setPhoto,
} from '@/lib/inventory';
import { STARTER_LIST } from '@/lib/inventory-starter';
import { addMember } from '@/lib/members';
import { useTestDb } from '../setup/db';

// A one-pixel PNG.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('inventory', () => {
  const getDb = useTestDb();
  let lead: Member;
  beforeAll(async () => {
    lead = await addMember(getDb(), { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
  });
  const named = async (name: string) => (await listInventory(getDb())).find((item) => item.name === name);

  it('adds an item with no count yet, and refuses an empty name, a name already there and a group it does not know', async () => {
    const db = getDb();
    const made = await addItem(db, { name: '  Test   widget ', category: 'Motors' }, lead.id);
    expect(made).toMatchObject({ name: 'Test widget', category: 'Motors', count: null, have: true });
    expect((await addItem(db, { name: 'Counted widget', category: 'Tools', count: 4 }, lead.id)).count).toBe(4);
    await expect(addItem(db, { name: ' ', category: 'Motors' }, lead.id)).rejects.toThrow(UserError);
    await expect(addItem(db, { name: 'test WIDGET', category: 'Tools' }, lead.id)).rejects.toThrow(UserError);
    await expect(addItem(db, { name: 'Other widget', category: 'Not a group' }, lead.id)).rejects.toThrow(UserError);
    await expect(addItem(db, { name: 'x'.repeat(81), category: 'Tools' }, lead.id)).rejects.toThrow(UserError);
    expect((await listInventory(db)).map((item) => item.name).sort()).toEqual(['Counted widget', 'Test widget']);
  });

  it('sets a count, says who counted and when, takes "not counted" back, and refuses a count that is not a whole number from 0 up', async () => {
    const db = getDb();
    const item = (await named('Test widget'))!;
    await setCount(db, item.id, 12, lead.id);
    expect(await named('Test widget')).toMatchObject({ count: 12, countedById: lead.id });
    expect((await named('Test widget'))!.countedAt).toBeInstanceOf(Date);
    await setCount(db, item.id, 0, lead.id);
    expect((await named('Test widget'))!.count).toBe(0);
    for (const bad of [-1, 1.5, 100000, Number.NaN]) await expect(setCount(db, item.id, bad, lead.id)).rejects.toThrow(UserError);
    expect((await named('Test widget'))!.count).toBe(0);
    await setCount(db, item.id, null, lead.id);
    expect(await named('Test widget')).toMatchObject({ count: null, countedAt: null, countedById: null });
  });

  it('a member adds to a count and takes from it, never below zero, and the log says who, what, how many and when', async () => {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    const item = await addItem(db, { name: 'Shelf part', category: 'Hardware' }, lead.id);
    // Nobody has counted it: there is nothing to take yet. Adding starts the count.
    await expect(changeCount(db, item.id, -1, member.id)).rejects.toMatchObject({ key: 'inventoryNotCounted' });
    expect(await changeCount(db, item.id, 5, member.id)).toBe(5);
    expect(await changeCount(db, item.id, -2, member.id)).toBe(3);
    await expect(changeCount(db, item.id, -4, member.id)).rejects.toMatchObject({ key: 'inventoryTakeTooMany' });
    for (const bad of [0, 1.5, 100000, -100000, Number.NaN]) await expect(changeCount(db, item.id, bad, member.id)).rejects.toThrow(UserError);
    expect((await named('Shelf part'))!.count).toBe(3);
    // Four people each taking one at the same moment, with three on the shelf: three get one, one is told no.
    const tries = await Promise.allSettled([1, 2, 3, 4].map(() => changeCount(db, item.id, -1, member.id)));
    expect(tries.filter((t) => t.status === 'fulfilled')).toHaveLength(3);
    expect((await named('Shelf part'))!.count).toBe(0);
    await setCount(db, item.id, 9, lead.id);
    const log = (await inventoryLog(db, { limit: 50 })).filter((row) => row.item === 'Shelf part');
    // Newest first.
    expect(log.map((row) => [row.who, row.change, row.amount, row.from, row.to])).toEqual([
      ['Test Lead', 'count', null, 0, 9],
      ['Test Member A', 'take', 1, 1, 0],
      ['Test Member A', 'take', 1, 2, 1],
      ['Test Member A', 'take', 1, 3, 2],
      ['Test Member A', 'take', 2, 5, 3],
      ['Test Member A', 'put', 5, null, 5],
    ]);
    expect(log.every((row) => row.at instanceof Date)).toBe(true);
    // Someone switched off cannot change a count.
    const { setActive } = await import('@/lib/members');
    await setActive(db, member.id, false, lead.id);
    await expect(changeCount(db, item.id, 1, member.id)).rejects.toThrow(UserError);
  });

  it('"we don\'t have this" sets an item aside and keeps it, and it can be brought back', async () => {
    const db = getDb();
    const item = (await named('Counted widget'))!;
    await setHave(db, item.id, false, lead.id);
    expect(await named('Counted widget')).toMatchObject({ have: false, count: 4 });
    expect(await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id))).toHaveLength(1);
    await setHave(db, item.id, true, lead.id);
    expect((await named('Counted widget'))!.have).toBe(true);
  });

  it('keeps one photo for an item, hands the same bytes back, and refuses what is not a small picture', async () => {
    const db = getDb();
    const item = (await named('Test widget'))!;
    expect(item.hasPhoto).toBe(false);
    expect(await photoOf(db, item.id)).toBeNull();
    await setPhoto(db, item.id, { mime: 'image/png', base64: PIXEL }, lead.id);
    const first = (await named('Test widget'))!;
    expect(first.hasPhoto).toBe(true);
    const photo = (await photoOf(db, item.id))!;
    expect(photo.mime).toBe('image/png');
    expect(photo.bytes.equals(Buffer.from(PIXEL, 'base64'))).toBe(true);
    // A new photo takes the old one's place, and the address of the picture changes with it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await setPhoto(db, item.id, { mime: 'image/jpeg', base64: PIXEL }, lead.id);
    const second = (await named('Test widget'))!;
    expect(second.photoVersion).not.toBe(first.photoVersion);
    expect((await photoOf(db, item.id))!.mime).toBe('image/jpeg');
    const tooBig = Buffer.alloc(PHOTO_MAX_BYTES + 1, 1).toString('base64');
    await expect(setPhoto(db, item.id, { mime: 'image/png', base64: tooBig }, lead.id)).rejects.toThrow(UserError);
    await expect(setPhoto(db, item.id, { mime: 'image/svg+xml', base64: PIXEL }, lead.id)).rejects.toThrow(UserError);
    await expect(setPhoto(db, item.id, { mime: 'image/png', base64: '' }, lead.id)).rejects.toThrow(UserError);
    await expect(setPhoto(db, item.id, { mime: 'image/png', base64: 'not base64 at all!!' }, lead.id)).rejects.toThrow(UserError);
    expect((await photoOf(db, item.id))!.mime).toBe('image/jpeg');
  });

  it('the starter list is well formed: over a hundred things, each in a known group, no name twice', () => {
    expect(STARTER_LIST.length).toBeGreaterThan(100);
    const names = STARTER_LIST.map((item) => item.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const item of STARTER_LIST) {
      expect(INVENTORY_CATEGORIES).toContain(item.category);
      expect(item.name.trim()).toBe(item.name);
      expect(item.name.length).toBeGreaterThan(1);
      expect(item.name.length).toBeLessThanOrEqual(80);
    }
    // Every group has something in it.
    for (const category of INVENTORY_CATEGORIES) expect(STARTER_LIST.some((item) => item.category === category)).toBe(true);
  });

  it('loads the starter list once, with no counts, and a second run changes nothing, not even an item that was set aside', async () => {
    const db = getDb();
    const before = (await listInventory(db)).length;
    const first = await addStarterList(db, lead.id);
    expect(first).toEqual({ added: STARTER_LIST.length, already: 0 });
    const all = await listInventory(db);
    expect(all).toHaveLength(before + STARTER_LIST.length);
    expect(all.filter((item) => STARTER_LIST.some((s) => s.name === item.name)).every((item) => item.count === null && item.have)).toBe(true);
    // In the order of the groups, then by name.
    const groups = all.map((item) => INVENTORY_CATEGORIES.indexOf(item.category as (typeof INVENTORY_CATEGORIES)[number]));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    const gone = all.find((item) => item.name === STARTER_LIST[0].name)!;
    await setHave(db, gone.id, false, lead.id);
    await setCount(db, all.find((item) => item.name === STARTER_LIST[1].name)!.id, 7, lead.id);
    expect(await addStarterList(db, lead.id)).toEqual({ added: 0, already: STARTER_LIST.length });
    expect((await named(STARTER_LIST[0].name))!.have).toBe(false);
    expect((await named(STARTER_LIST[1].name))!.count).toBe(7);
    expect(await listInventory(db)).toHaveLength(before + STARTER_LIST.length);
  });

  it('members do not see the list until a captain switches that on', async () => {
    const db = getDb();
    expect(await membersSeeInventory(db)).toBe(false);
    await setMembersSeeInventory(db, true, lead.id);
    expect(await membersSeeInventory(db)).toBe(true);
    await setMembersSeeInventory(db, false, lead.id);
    expect(await membersSeeInventory(db)).toBe(false);
  });

  it('writes who did what in the change log, without the picture', async () => {
    const rows = await getDb().select().from(changeLog).where(eq(changeLog.entity, 'inventory'));
    const actions = new Set(rows.map((row) => row.action));
    for (const action of ['inventory.add', 'inventory.count', 'inventory.put', 'inventory.take', 'inventory.have', 'inventory.photo', 'inventory.starter', 'inventory.members_see']) {
      expect(actions).toContain(action);
    }
    expect(rows.every((row) => row.actorId !== null)).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.detail))).not.toContain(PIXEL);
  });
});
