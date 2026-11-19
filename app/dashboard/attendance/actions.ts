'use server';

import { revalidatePath } from 'next/cache';
import { setByHand, strikeDay, unstrikeDay } from '@/lib/attendance';
import { requireLead } from '@/lib/auth/session';
import { isDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';

function refresh() {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/attendance');
}

export async function markByHand(form: FormData): Promise<void> {
  const lead = await requireLead();
  const memberId = String(form.get('memberId') ?? '');
  const day = String(form.get('day') ?? '');
  if (!isUuid(memberId) || !isDay(day)) return;
  await setByHand(getDb(), {
    memberId,
    day,
    present: form.get('present') === '1',
    actorId: lead.id,
    at: new Date(),
  });
  refresh();
}

export async function setStruck(form: FormData): Promise<void> {
  const lead = await requireLead();
  const day = String(form.get('day') ?? '');
  if (!isDay(day)) return;
  if (form.get('struck') === '1') await strikeDay(getDb(), day, lead.id);
  else await unstrikeDay(getDb(), day, lead.id);
  refresh();
}
