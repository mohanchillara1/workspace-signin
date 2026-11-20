'use server';

import { redirect } from 'next/navigation';
import { checkLogin } from '@/lib/auth/leads';
import { checkMemberLogin } from '@/lib/auth/member-logins';
import { clientAddress, signInLead, signOutLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: string };

export async function logIn(_previous: LoginState, form: FormData): Promise<LoginState> {
  const loginName = String(form.get('loginName') ?? '');
  const password = String(form.get('password') ?? '');
  const result = await checkLogin(getDb(), {
    loginName,
    password,
    ip: await clientAddress(),
    now: new Date(),
  });
  if (!result.ok && result.reason === 'locked') return { error: copy.login.locked };
  if (!result.ok) {
    // Not a lead: maybe a member. A member login opens only their own page.
    const pageKey = await checkMemberLogin(getDb(), { loginName, password });
    if (pageKey) redirect(`/m/${pageKey}`);
    return { error: copy.login.wrong };
  }
  await signInLead(result.memberId, result.version);
  redirect('/dashboard');
}

export async function logOut(): Promise<void> {
  await signOutLead();
  redirect('/login');
}
