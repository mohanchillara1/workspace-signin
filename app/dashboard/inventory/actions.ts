'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireLead } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { errorKey, UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import { addItem, changeCount, setCount, setHave, setMembersSeeInventory, setPhoto } from '@/lib/inventory';

const PAGE = '/dashboard/inventory';
const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
// The page gets a key, not words, so a link cannot put words of its own on it.
const refused = (error: unknown, id?: string): never => redirect(`${PAGE}?problem=${errorKey(error)}${id ? `#i-${id}` : ''}`);
const done = (id?: string): never => {
  revalidatePath(PAGE);
  redirect(`${PAGE}${id ? `#i-${id}` : ''}`);
};
/** A whole number typed in a box, or NaN. An empty box is NaN too. */
const whole = (value: string) => (/^\d{1,6}$/.test(value) ? Number(value) : Number.NaN);

export async function addItemAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  let id: string | undefined;
  try {
    const count = text(form, 'count');
    if (count !== '' && Number.isNaN(whole(count))) throw new UserError('inventoryCount');
    id = (await addItem(getDb(), { name: text(form, 'name'), category: text(form, 'category'), count: count === '' ? null : whole(count) }, lead.id)).id;
  } catch (error) {
    refused(error);
  }
  done(id);
}

/** One box and three buttons: write the count down, add that many, or take that many. */
export async function countAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const id = text(form, 'id');
  try {
    if (!isUuid(id)) throw new UserError('inventoryMissing');
    const what = text(form, 'what');
    const amount = whole(text(form, 'amount'));
    if (what === 'set') await setCount(getDb(), id, amount, lead.id);
    else await changeCount(getDb(), id, what === 'take' ? -amount : amount, lead.id);
  } catch (error) {
    refused(error, id);
  }
  done(id);
}

export async function haveAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const id = text(form, 'id');
  try {
    if (!isUuid(id)) throw new UserError('inventoryMissing');
    await setHave(getDb(), id, text(form, 'have') === '1', lead.id);
  } catch (error) {
    refused(error, id);
  }
  done();
}

/** Only a captain opens the inventory to members or closes it. */
export async function membersAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  try {
    if (lead.role !== 'captain') throw new UserError('leadsAreCaptainOnly');
    await setMembersSeeInventory(getDb(), text(form, 'on') === '1', lead.id);
  } catch (error) {
    refused(error);
  }
  done();
}

/** The small copy of a photo that the browser made, as base64 JPEG. */
export async function savePhoto(itemId: string, base64: string): Promise<{ ok: boolean }> {
  const lead = await requireLead();
  try {
    if (!isUuid(itemId) || typeof base64 !== 'string') return { ok: false };
    await setPhoto(getDb(), itemId, { mime: 'image/jpeg', base64 }, lead.id);
  } catch (error) {
    if (error instanceof UserError) return { ok: false };
    throw error;
  }
  revalidatePath(PAGE);
  return { ok: true };
}
