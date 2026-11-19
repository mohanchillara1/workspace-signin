'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireLead } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { closeTask, createTask, publishTask, release, reopen, updateTask, type TaskInput } from '@/lib/tasks';

export type TaskFormState = { problem?: string };

function read(form: FormData): TaskInput {
  const audience = String(form.get('audience') ?? 'pool');
  return {
    title: String(form.get('title') ?? ''),
    description: String(form.get('description') ?? ''),
    steps: String(form.get('steps') ?? '').split(/\r?\n/),
    audience: audience === 'person' || audience === 'subteam' ? audience : 'pool',
    memberIds: form.getAll('memberIds').map(String),
    subteamId: String(form.get('subteamId') ?? '') || null,
    completion: form.get('completion') === 'each' ? 'each' : 'once',
    dueDay: String(form.get('dueDay') ?? '') || null,
    standing: form.get('standing') === 'on',
    needsCheck: form.get('needsCheck') === 'on',
  };
}

/** Saves the task form. The button pressed says what else to do: publish or close. */
export async function saveTask(_previous: TaskFormState, form: FormData): Promise<TaskFormState> {
  const lead = await requireLead();
  const db = getDb();
  const intent = String(form.get('intent') ?? 'save');
  let id = String(form.get('id') ?? '');
  try {
    if (intent === 'close' && id) {
      await closeTask(db, id, lead.id);
    } else {
      const input = read(form);
      if (id) await updateTask(db, id, input, lead.id);
      else id = (await createTask(db, input, lead.id)).id;
      if (intent === 'publish') await publishTask(db, id, lead.id);
    }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'Something went wrong' };
  }
  revalidatePath('/dashboard/tasks');
  const note = intent === 'publish' ? 'published' : intent === 'close' ? 'closed' : 'saved';
  redirect(`/dashboard/tasks/${id}?note=${note}`);
}

export async function takeBack(form: FormData): Promise<void> {
  const lead = await requireLead();
  await release(getDb(), String(form.get('assignmentId') ?? ''), lead.id);
  revalidatePath('/dashboard/tasks');
}

export async function reopenFinished(form: FormData): Promise<void> {
  const lead = await requireLead();
  await reopen(getDb(), String(form.get('assignmentId') ?? ''), lead.id);
  revalidatePath('/dashboard/finished');
}
