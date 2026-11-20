'use server';

import { redirect } from 'next/navigation';
import { checkLogin } from '@/lib/auth/leads';
import { logInByName } from '@/lib/auth/member-logins';
import { clientAddress, signInLead, signOutLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: string };

export async function logIn(_previous: LoginState, form: FormData): Promise<LoginState> {
  const result = await checkLogin(getDb(), {
    loginName: String(form.get('loginName') ?? ''),
    password: String(form.get('password') ?? ''),
    ip: await clientAddress(),
    now: new Date(),
  });
  if (!result.ok) return { error: result.reason === 'locked' ? copy.login.locked : copy.login.wrong };
  await signInLead(result.memberId, result.version);
  redirect('/dashboard');
}

/** A member types their first and last name and lands on their own page. */
export async function openMemberPage(_previous: LoginState, form: FormData): Promise<LoginState> {
  const result = await logInByName(getDb(), {
    firstName: String(form.get('firstName') ?? ''),
    lastName: String(form.get('lastName') ?? ''),
    ip: await clientAddress(),
    now: new Date(),
  });
  if (result.ok) redirect(`/m/${result.pageKey}`);
  const c = copy.login;
  return { error: result.reason === 'locked' ? c.memberLocked : result.reason === 'two_match' ? c.memberTwoMatch : c.memberNotFound };
}

export async function logOut(): Promise<void> {
  await signOutLead();
  redirect('/admin');
}
