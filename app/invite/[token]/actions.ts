'use server';

import { redirect } from 'next/navigation';
import { acceptInvite } from '@/lib/auth/leads';
import { signInLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';

export type InviteState = { error?: string };

export async function setLogin(_previous: InviteState, form: FormData): Promise<InviteState> {
  const result = await acceptInvite(getDb(), {
    token: String(form.get('token') ?? ''),
    loginName: String(form.get('loginName') ?? ''),
    password: String(form.get('password') ?? ''),
    now: new Date(),
  });
  if (!result.ok) {
    const c = copy.invite;
    const messages = { bad_link: c.badLinkBody, weak_password: c.weakPassword, bad_name: c.badName, name_taken: c.nameTaken };
    return { error: messages[result.reason] };
  }
  await signInLead(result.memberId, result.version);
  redirect('/dashboard');
}
