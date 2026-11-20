// The team's inventory: what is on the shelves, how many, and a picture.
// Leads and captains keep the list. Members add to a count and take from it,
// and every change of a count is written down with who made it and when.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/client';
import { changeLog, inventoryItems, inventoryPhotos, members, settings, type InventoryItem } from './db/schema';
import { UserError } from './errors';
import { STARTER_LIST } from './inventory-starter';
import { logChange } from './log';
import { hit } from './rate-limit';

export const INVENTORY_CATEGORIES = [
  'Control system',
  'Motors',
  'Motor controllers',
  'Sensors and cameras',
  'Batteries and power',
  'Wire and connectors',
  'Pneumatics',
  'Drivetrain and mechanical',
  'Hardware',
  'Tools',
  'Driver station and pit',
  'Safety',
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

const NAME_MAX = 80;
export const COUNT_MAX = 99_999;
/** A photo is shrunk in the browser first. This is the most the server keeps. */
export const PHOTO_MAX_BYTES = 300_000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MEMBERS_SEE = 'members_see_inventory';
/** Page loads and changes from one address in a minute: enough for a whole room on one wifi. */
export const ADDRESS_USES_A_MINUTE = 600;
/** Page loads and changes by one member in a minute. A change is two: the change, then the page again. */
export const MEMBER_USES_A_MINUTE = 120;

export type InventoryRow = InventoryItem & { hasPhoto: boolean; photoVersion: number | null };

const isCategory = (value: string): value is InventoryCategory => (INVENTORY_CATEGORIES as readonly string[]).includes(value);
const wholeCount = (value: number) => Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;

/** Holds the item's row until the transaction ends, so two changes to one count take turns. */
async function lockItem(tx: Db, id: string): Promise<InventoryItem | null> {
  await tx.execute(sql`select 1 from ${inventoryItems} where ${inventoryItems.id} = ${id} for update`);
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
  return item ?? null;
}

/**
 * A line in the change log for a change of a count. Its time is the moment it
 * is written, not when the transaction began, so the log reads in the order
 * the changes took effect.
 */
async function noteCount(tx: Db, actorId: string | null, action: string, itemId: string, detail: Record<string, unknown>) {
  await tx.insert(changeLog).values({ actorId, action, entity: 'inventory', entityId: itemId, detail, at: sql`clock_timestamp()` });
}

/** Every item, in the order of the groups, then by name. Items set aside are in it too. */
export async function listInventory(db: Db): Promise<InventoryRow[]> {
  const rows = await db
    .select({ item: inventoryItems, photoAt: inventoryPhotos.updatedAt })
    .from(inventoryItems)
    .leftJoin(inventoryPhotos, eq(inventoryPhotos.itemId, inventoryItems.id));
  const place = (category: string) => {
    const at = (INVENTORY_CATEGORIES as readonly string[]).indexOf(category);
    return at === -1 ? INVENTORY_CATEGORIES.length : at;
  };
  return rows
    .map((r) => ({ ...r.item, hasPhoto: r.photoAt !== null, photoVersion: r.photoAt?.getTime() ?? null }))
    .sort((a, b) => place(a.category) - place(b.category) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export async function addItem(
  db: Db,
  input: { name: string; category: string; count?: number | null },
  actorId: string | null,
): Promise<InventoryItem> {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) throw new UserError('inventoryName');
  if (name.length > NAME_MAX) throw new UserError('inventoryNameLong');
  if (!isCategory(input.category)) throw new UserError('inventoryCategory');
  const count = input.count ?? null;
  if (count !== null && !wholeCount(count)) throw new UserError('inventoryCount');
  return db.transaction(async (tx) => {
    const [made] = await tx
      .insert(inventoryItems)
      .values({ name, category: input.category, count, countedAt: count === null ? null : new Date(), countedById: count === null ? null : actorId })
      .onConflictDoNothing()
      .returning();
    if (!made) throw new UserError('inventoryNameTaken');
    await logChange(tx, { actorId, action: 'inventory.add', entity: 'inventory', entityId: made.id, detail: { name, category: input.category } });
    // A count given with the new item is the first line of that item's count log.
    if (count !== null) await noteCount(tx, actorId, 'inventory.count', made.id, { from: null, to: count });
    return made;
  });
}

/** A lead writes down what was counted. Null takes the count back to "not counted yet". */
export async function setCount(db: Db, id: string, count: number | null, actorId: string | null): Promise<void> {
  if (count !== null && !wholeCount(count)) throw new UserError('inventoryCount');
  await db.transaction(async (tx) => {
    const item = await lockItem(tx, id);
    if (!item) throw new UserError('inventoryMissing');
    await tx
      .update(inventoryItems)
      .set({ count, countedAt: count === null ? null : new Date(), countedById: count === null ? null : actorId })
      .where(eq(inventoryItems.id, id));
    await noteCount(tx, actorId, 'inventory.count', id, { from: item.count, to: count });
  });
}

/**
 * Someone puts some on the shelf (a number above zero) or takes some off it
 * (below zero). The count never goes under zero, and nothing can be taken
 * from an item nobody has counted yet. Returns the new count.
 */
export async function changeCount(db: Db, id: string, amount: number, actorId: string): Promise<number> {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > COUNT_MAX) throw new UserError('inventoryAmount');
  return db.transaction(async (tx) => {
    const [actor] = await tx.select().from(members).where(eq(members.id, actorId));
    if (!actor || !actor.active) throw new UserError('generic');
    const item = await lockItem(tx, id);
    if (!item || !item.have) throw new UserError('inventoryMissing');
    if (amount < 0 && item.count === null) throw new UserError('inventoryNotCounted');
    const to = (item.count ?? 0) + amount;
    if (to < 0) throw new UserError('inventoryTakeTooMany');
    if (to > COUNT_MAX) throw new UserError('inventoryCount');
    await tx.update(inventoryItems).set({ count: to, countedAt: new Date(), countedById: actor.id }).where(eq(inventoryItems.id, id));
    await noteCount(tx, actor.id, amount > 0 ? 'inventory.put' : 'inventory.take', id, { amount: Math.abs(amount), from: item.count, to });
    return to;
  });
}

/** "We don't have this" sets an item aside. It stays in the table and can be brought back. */
export async function setHave(db: Db, id: string, have: boolean, actorId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const changed = await tx.update(inventoryItems).set({ have }).where(eq(inventoryItems.id, id)).returning({ id: inventoryItems.id });
    if (changed.length === 0) throw new UserError('inventoryMissing');
    await logChange(tx, { actorId, action: 'inventory.have', entity: 'inventory', entityId: id, detail: { have } });
  });
}

/** Keeps one photo for an item, in place of any it had. The picture itself is never logged. */
export async function setPhoto(db: Db, id: string, photo: { mime: string; base64: string }, actorId: string | null): Promise<void> {
  const data = photo.base64.replace(/\s+/g, '');
  if (!PHOTO_TYPES.includes(photo.mime) || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new UserError('inventoryPhoto');
  const size = Buffer.from(data, 'base64').length;
  if (size === 0 || size > PHOTO_MAX_BYTES) throw new UserError('inventoryPhoto');
  const [item] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.id, id));
  if (!item) throw new UserError('inventoryMissing');
  const now = new Date();
  await db
    .insert(inventoryPhotos)
    .values({ itemId: id, mime: photo.mime, data, updatedAt: now })
    .onConflictDoUpdate({ target: inventoryPhotos.itemId, set: { mime: photo.mime, data, updatedAt: now } });
  await logChange(db, { actorId, action: 'inventory.photo', entity: 'inventory', entityId: id, detail: { bytes: size } });
}

export async function photoOf(db: Db, id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await db.select().from(inventoryPhotos).where(eq(inventoryPhotos.itemId, id));
  return row ? { mime: row.mime, bytes: Buffer.from(row.data, 'base64') } : null;
}

/** Adds every starter item that is not on the list yet (any letter case). Touches nothing that is. */
export async function addStarterList(db: Db, actorId: string | null): Promise<{ added: number; already: number }> {
  return db.transaction(async (tx) => {
    const made = await tx.insert(inventoryItems).values(STARTER_LIST).onConflictDoNothing().returning({ id: inventoryItems.id });
    const result = { added: made.length, already: STARTER_LIST.length - made.length };
    await logChange(tx, { actorId, action: 'inventory.starter', entity: 'inventory', detail: result });
    return result;
  });
}

/** Whether members can open the inventory from their own page. Off until a captain turns it on. */
export async function membersSeeInventory(db: Db): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.key, MEMBERS_SEE));
  return row?.value === '1';
}

export async function setMembersSeeInventory(db: Db, on: boolean, actorId: string | null): Promise<void> {
  const value = on ? '1' : '0';
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: MEMBERS_SEE, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await logChange(tx, { actorId, action: 'inventory.members_see', entity: 'inventory', detail: { on } });
  });
}

/**
 * The two ceilings on a member's use of the inventory. The first is asked
 * before anyone is looked up, so a flood of wrong keys costs little; it is
 * per address and high, because a whole team shares the workshop's wifi. The
 * second is per member once they are known, so one person cannot use up the
 * room's share.
 */
export async function addressMayUseInventory(db: Db, address: string, now: Date): Promise<boolean> {
  return (await hit(db, { key: `inventory-ip:${address}`, limit: ADDRESS_USES_A_MINUTE, windowSeconds: 60, now })).allowed;
}

export async function memberMayUseInventory(db: Db, memberId: string, now: Date): Promise<boolean> {
  return (await hit(db, { key: `inventory-member:${memberId}`, limit: MEMBER_USES_A_MINUTE, windowSeconds: 60, now })).allowed;
}

export type InventoryLogRow = {
  at: Date;
  /** The whole name, for leads only. Empty when a script did it. */
  who: string;
  item: string;
  /** put: added to the count. take: taken from it. count: a lead wrote the count down. */
  change: 'put' | 'take' | 'count';
  amount: number | null;
  from: number | null;
  to: number | null;
};

/** Every change of a count, newest first: who, which item, how many, when. */
export async function inventoryLog(db: Db, options: { limit: number }): Promise<InventoryLogRow[]> {
  const rows = await db
    .select()
    .from(changeLog)
    .where(and(eq(changeLog.entity, 'inventory'), inArray(changeLog.action, ['inventory.put', 'inventory.take', 'inventory.count'])))
    .orderBy(desc(changeLog.at))
    .limit(options.limit);
  const people = new Map((await db.select().from(members)).map((m) => [m.id, `${m.firstName} ${m.lastName}`.trim()]));
  const items = new Map((await db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems)).map((i) => [i.id, i.name]));
  const number = (value: unknown) => (typeof value === 'number' ? value : null);
  return rows.map((row) => ({
    at: row.at,
    who: row.actorId ? (people.get(row.actorId) ?? '') : '',
    item: items.get(row.entityId ?? '') ?? '',
    change: row.action === 'inventory.put' ? 'put' : row.action === 'inventory.take' ? 'take' : 'count',
    amount: number(row.detail.amount),
    from: number(row.detail.from),
    to: number(row.detail.to),
  }));
}
