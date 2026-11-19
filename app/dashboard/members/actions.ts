'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createInvite } from '@/lib/auth/leads';
import { isHttps, requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { UserError } from '@/lib/errors';
import {
  addMember,
  addSubteam,
  importRoster,
  memberById,
  reissuePageKey,
  reissueScanCode,
  setActive,
  updateMember,
  type Role,
} from '@/lib/members';

const ROLES: Role[] = ['member', 'lead', 'captain'];
const text = (form: FormData, name: string) => String(form.get(name) ?? '');
const problem = (error: unknown) => encodeURIComponent(error instanceof UserError ? error.message : copy.errors.generic);

export async function addMemberAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const role = text(form, 'role') as Role;
  try {
    await addMember(
      getDb(),
      {
        firstName: text(form, 'firstName'),
        lastName: text(form, 'lastName'),
        subteamId: text(form, 'subteamId') || null,
        // Only a captain can hand out lead or captain roles.
        role: lead.role === 'captain' && ROLES.includes(role) ? role : 'member',
      },
      lead.id,
    );
  } catch (error) {
    redirect(`/dashboard/members?problem=${problem(error)}`);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export async function editMemberAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const id = text(form, 'id');
  const role = text(form, 'role') as Role;
  try {
    await updateMember(
      getDb(),
      id,
      {
        firstName: text(form, 'firstName'),
        lastName: text(form, 'lastName'),
        subteamId: text(form, 'subteamId') || null,
        ...(lead.role === 'captain' && ROLES.includes(role) && id !== lead.id ? { role } : {}),
      },
      lead.id,
    );
  } catch (error) {
    redirect(`/dashboard/members?problem=${problem(error)}`);
  }
  revalidatePath('/dashboard/members');
  redirect('/dashboard/members');
}

export async function rosterAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const result = await importRoster(getDb(), text(form, 'roster').slice(0, 20_000), lead.id);
  revalidatePath('/dashboard/members');
  redirect(`/dashboard/members?added=${result.added}&skipped=${result.skipped.length}`);
}

export async function addSubteamAction(form: FormData): Promise<void> {
  await requireLead();
  try {
    await addSubteam(getDb(), text(form, 'name'));
  } catch (error) {
    redirect(`/dashboard/members?problem=${problem(error)}`);
  }
  revalidatePath('/dashboard/members');
}

export async function memberRowAction(form: FormData): Promise<void> {
  const lead = await requireLead();
  const db = getDb();
  const id = text(form, 'id');
  const what = text(form, 'what');
  if (!(await memberById(db, id))) return;
  if (what === 'new-code') await reissueScanCode(db, id, lead.id);
  else if (what === 'new-link') await reissuePageKey(db, id, lead.id);
  else if (what === 'deactivate' && id !== lead.id) await setActive(db, id, false, lead.id);
  else if (what === 'reactivate') await setActive(db, id, true, lead.id);
  revalidatePath('/dashboard/members');
}

export type InviteLinkState = { link?: string; problem?: string };

/** A captain makes a one-time link for a lead. It is shown once and not stored. */
export async function makeInvite(_previous: InviteLinkState, form: FormData): Promise<InviteLinkState> {
  const lead = await requireLead();
  try {
    const token = await createInvite(getDb(), { memberId: text(form, 'id'), actorId: lead.id, now: new Date() });
    const host = (await headers()).get('host') ?? 'localhost';
    return { link: `${(await isHttps()) ? 'https' : 'http'}://${host}/invite/${token}` };
  } catch (error) {
    return { problem: error instanceof UserError ? error.message : copy.errors.generic };
  }
}
