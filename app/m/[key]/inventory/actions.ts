'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clientAddress } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { errorKey, UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { addressMayUseInventory, changeCount, listInventory, memberAddItem, memberMayUseInventory, membersSeeInventory } from '@/lib/inventory';
import { memberByPageKey } from '@/lib/members';

/**
 * A member adds to a count or takes from it. Apart from adding an item a group
 * is missing (below), that is all a member can do here: photos, setting an
 * item aside and the exact count are a lead's.
 * The page key is the member's only credential, so the member is looked up
 * from it again, and their name goes in the log with the change.
 */
export async function memberCountAction(form: FormData): Promise<void> {
  const key = String(form.get('key') ?? '');
  const id = String(form.get('id') ?? '');
  const db = getDb();
  const now = new Date();
  // Asked before anyone is looked up, so wrong keys sent in a flood cost little.
  if (!(await addressMayUseInventory(db, await clientAddress(), now))) redirect('/login');
  const member = await memberByPageKey(db, key);
  // A wrong key, or the inventory closed to members, gets the same answer as a page that is not there.
  if (!member || !(await membersSeeInventory(db))) redirect('/login');
  const page = `/m/${key}/inventory`;
  // Which group to show open again when the page comes back.
  const group = `g=${encodeURIComponent(String(form.get('group') ?? '').slice(0, 60))}`;
  try {
    if (!(await memberMayUseInventory(db, member.id, now))) throw new UserError('inventorySlow');
    if (!isUuid(id)) throw new UserError('inventoryMissing');
    const typed = String(form.get('amount') ?? '').trim();
    const amount = /^\d{1,6}$/.test(typed) ? Number(typed) : Number.NaN;
    await changeCount(db, id, form.get('what') === 'take' ? -amount : amount, member.id);
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    redirect(`${page}?problem=${errorKey(error)}&${group}${isUuid(id) ? `#i-${id}` : ''}`);
  }
  revalidatePath(page);
  redirect(`${page}?${group}#i-${id}`);
}

/**
 * A member adds an item the group they are looking at is missing (Mohan,
 * 2026-11-20). One a lead set aside under that name comes back instead, and the
 * page then shows the group it is in.
 */
export async function memberAddAction(form: FormData): Promise<void> {
  const key = String(form.get('key') ?? '');
  const db = getDb();
  const now = new Date();
  if (!(await addressMayUseInventory(db, await clientAddress(), now))) redirect('/login');
  const member = await memberByPageKey(db, key);
  if (!member || !(await membersSeeInventory(db))) redirect('/login');
  const page = `/m/${key}/inventory`;
  const category = String(form.get('group') ?? '').slice(0, 60);
  let shown = category;
  let id = '';
  try {
    if (!(await memberMayUseInventory(db, member.id, now))) throw new UserError('inventorySlow');
    const typed = String(form.get('count') ?? '').trim();
    if (typed && !/^\d{1,5}$/.test(typed)) throw new UserError('inventoryCount');
    const made = await memberAddItem(db, { name: String(form.get('name') ?? ''), category, count: typed ? Number(typed) : null }, member.id);
    id = made.id;
    if (made.brought) {
      const [item] = (await listInventory(db)).filter((row) => row.id === made.id);
      if (item) shown = item.category;
    }
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    redirect(`${page}?problem=${errorKey(error)}&g=${encodeURIComponent(category)}#add`);
  }
  revalidatePath(page);
  redirect(`${page}?g=${encodeURIComponent(shown)}#i-${id}`);
}
