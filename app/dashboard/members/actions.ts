'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createInvite } from '@/lib/auth/leads';
import { setMemberLogin } from '@/lib/auth/member-logins';
import { isHttps, requireLead } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { errorKey, errorText, UserError } from '@/lib/errors';
import { isUuid } from '@/lib/ids';
import {
  addMember,
  addSubteam,
  assertMayManage,
  importRoster,
  reissuePageKey,
  reissueScanCode,
  removeSubteam,
  setActive,
  updateMember,
  type ManageAction,
  type Role,
} from '@/lib/members';

const ROLES: Role[] = ['member', 'lead', 'captain'];
const ROSTER_MAX = 200_000;
const text = (form: FormData, name: string) => String(form.get(name) ?? '');
// The page gets a key, not words, so a link cannot put words of its own on it.
const refused = (error: unknown): never => redirect(`/dashboard/members?problem=${errorKey(error)}`);

export async function addMemberAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const role = text(form, 'role') as Role;
  try {
    await addMember(
      getDb(),
      {
        firstName: text(form, 'firstName'),
        lastName: text(form, 'lastName'),
        subteamId: isUuid(form.get('subteamId')) ? text(form, 'subteamId') : null,
        // Only a captain can hand out lead or captain roles.
        role: lead.role === 'captain' && ROLES.includes(role) ? role : 'member',
      },
      lead.id,
    );
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export async function editMemberAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const db = getDb();
  const id = form.get('id');
  const role = text(form, 'role') as Role;
  try {
    if (!isUuid(id)) throw new UserError('generic');
    const target = await assertMayManage(db, lead.id, id, 'edit');
    const newRole = ROLES.includes(role) && role !== target.role ? role : undefined;
    if (newRole) await assertMayManage(db, lead.id, id, 'role');
    await updateMember(
      db,
      id,
      {
        firstName: text(form, 'firstName'),
        lastName: text(form, 'lastName'),
        subteamId: isUuid(form.get('subteamId')) ? text(form, 'subteamId') : null,
        ...(newRole ? { role: newRole } : {}),
      },
      lead.id,
    );
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export async function rosterAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  let result = { added: 0, skipped: [] as string[], already: [] as string[] };
  try {
    const file = form.get('file');
    const pasted = text(form, 'roster');
    let uploaded = '';
    if (file instanceof File && file.size > 0) {
      if (file.size > ROSTER_MAX) throw new UserError('rosterBig');
      uploaded = await file.text();
    }
    if (pasted.length > ROSTER_MAX) throw new UserError('rosterBig');
    result = await importRoster(getDb(), `${pasted}\n${uploaded}`, lead.id);
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect(`/dashboard/members?added=${result.added}&skipped=${result.skipped.length}&already=${result.already.length}`);
}

export async function addSubteamAction(form: FormData): Promise<void> {
  await requireLead();
  try {
    await addSubteam(getDb(), text(form, 'name'));
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export async function removeSubteamAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  try {
    const id = form.get('id');
    if (isUuid(id)) await removeSubteam(getDb(), id, lead.id);
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

const ROW_ACTIONS: ManageAction[] = ['new-code', 'new-link', 'deactivate', 'reactivate'];

export async function memberRowAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const db = getDb();
  const id = form.get('id');
  const what = text(form, 'what') as ManageAction;
  try {
    if (!isUuid(id) || !ROW_ACTIONS.includes(what)) throw new UserError('generic');
    await assertMayManage(db, lead.id, id, what);
    if (what === 'new-code') await reissueScanCode(db, id, lead.id);
    else if (what === 'new-link') await reissuePageKey(db, id, lead.id);
    else await setActive(db, id, what === 'reactivate', lead.id);
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export type InviteLinkState = { link?: string; problem?: string };

/** A captain makes a one-time link for a lead. It is shown once and not stored. */
export async function makeInvite(_previous: InviteLinkState, form: FormData): Promise<InviteLinkState> {
  const lead = await requireLead();
  try {
    const id = form.get('id');
    if (!isUuid(id)) throw new UserError('generic');
    const token = await createInvite(getDb(), { memberId: id, actorId: lead.id, now: new Date() });
    const host = (await headers()).get('host') ?? 'localhost';
    return { link: `${(await isHttps()) ? 'https' : 'http'}://${host}/invite/${token}` };
  } catch (error) {
    return { problem: errorText(errorKey(error)) };
  }
}

export async function setMemberLoginAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const db = getDb();
  const id = form.get('id');
  try {
    if (!isUuid(id)) throw new UserError('generic');
    const target = await assertMayManage(db, lead.id, id, 'edit');
    if (target.role !== 'member') throw new UserError('generic');
    await setMemberLogin(db, {
      memberId: target.id,
      loginName: text(form, 'loginName'),
      password: text(form, 'password'),
      actorId: lead.id,
      now: new Date(),
    });
  } catch (error) {
    refused(error);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}
