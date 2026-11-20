'use server';

import { redirect } from 'next/navigation';
import { logInAnyone } from '@/lib/auth/member-logins';
import { clientAddress, signInLead, signOutLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: string };

export async function logIn(_previous: LoginState, form: FormData): Promise<LoginState> {
  const result = await logInAnyone(getDb(), {
    loginName: String(form.get('loginName') ?? ''),
    password: String(form.get('password') ?? ''),
    ip: await clientAddress(),
    now: new Date(),
  });
  if (!result.ok) return { error: result.reason === 'locked' ? copy.login.locked : copy.login.wrong };
  // A member login opens only that member's own page.
  if (result.kind === 'member') redirect(`/m/${result.pageKey}`);
  await signInLead(result.memberId, result.version);
  redirect('/dashboard');
}

export async function logOut(): Promise<void> {
  await signOutLead();
  redirect('/login');
}
