'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clientAddress } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { errorKey, UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { changeCount, membersSeeInventory } from '@/lib/inventory';
import { memberByPageKey } from '@/lib/members';
import { hit } from '@/lib/rate-limit';

const CHANGES_A_MINUTE = 60;

/**
 * A member adds to a count or takes from it. That is all a member can do
 * here: the items themselves, their photos and the exact count are a lead's.
 * The page key is the member's only credential, so the member is looked up
 * from it again, and their name goes in the log with the change.
 */
export async function memberCountAction(form: FormData): Promise<void> {
  const key = String(form.get('key') ?? '');
  const id = String(form.get('id') ?? '');
  const db = getDb();
  const member = await memberByPageKey(db, key);
  // A wrong key, or the inventory closed to members, gets the same answer as a page that is not there.
  if (!member || !(await membersSeeInventory(db))) redirect('/login');
  const page = `/m/${key}/inventory`;
  // Which group to show open again when the page comes back.
  const group = `g=${encodeURIComponent(String(form.get('group') ?? '').slice(0, 60))}`;
  try {
    const allowed = await hit(db, { key: `inventory:${await clientAddress()}`, limit: CHANGES_A_MINUTE, windowSeconds: 60, now: new Date() });
    if (!allowed.allowed) throw new UserError('generic');
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
