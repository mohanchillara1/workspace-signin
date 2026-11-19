'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireLead, setKioskCookie, signOutLead } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { pairKiosk, unpairKiosk } from '@/lib/kiosk';

/** "Make this the kiosk": pair this browser, log the lead out here, open the scan page. */
export async function pairThisDevice(form: FormData): Promise<void> {
  const lead = await requireLead();
  const { token } = await pairKiosk(getDb(), { name: String(form.get('name') ?? ''), actorId: lead.id });
  await setKioskCookie(token);
  await signOutLead();
  redirect('/kiosk');
}

export async function unpairDevice(form: FormData): Promise<void> {
  const lead = await requireLead();
  const id = form.get('id');
  if (!isUuid(id)) return;
  await unpairKiosk(getDb(), id, lead.id);
  revalidatePath('/dashboard/kiosk');
}
