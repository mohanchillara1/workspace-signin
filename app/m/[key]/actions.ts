'use server';

import { revalidatePath } from 'next/cache';
import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { memberByPageKey } from '@/lib/members';
import { isUuid } from '@/lib/ids';
import { copy } from '@/lib/copy';
import { submitWork, type SubmitProblem } from '@/lib/submit';
import { claim, giveBack, setStepsDone } from '@/lib/tasks';

// The page key is the member's only credential, so every action starts by
// looking the member up from it again.

export async function tickSteps(key: string, assignmentId: string, stepsDone: number[]): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member || !isUuid(assignmentId) || !Array.isArray(stepsDone)) return;
  await setStepsDone(db, { assignmentId, memberId: member.id, stepsDone });
  revalidatePath(`/m/${key}`);
}

/** What a member's "Done" or "Send it in" came to. */
export type SendResult = { ok: true; state: 'submitted' | 'done' } | { ok: false; message: string };

const PROBLEM: Record<SubmitProblem, string> = {
  note_long: copy.submit.noteLong,
  link_bad: copy.submit.linkBad,
  link_long: copy.submit.linkLong,
};

/**
 * Finishes a hand-out. Always goes through submitWork, so a task that needs a
 * lead's check can never skip it, whatever is sent to this action.
 */
export async function sendIn(
  key: string,
  taskId: string,
  assignmentId: string | undefined,
  note: string,
  link: string,
): Promise<SendResult> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (
    !member ||
    !isUuid(taskId) ||
    (assignmentId !== undefined && !isUuid(assignmentId)) ||
    typeof note !== 'string' ||
    typeof link !== 'string'
  ) {
    return { ok: false, message: copy.submit.gone };
  }
  try {
    const result = await submitWork(db, {
      taskId,
      assignmentId,
      memberId: member.id,
      note,
      link,
      via: 'member_page',
      today: chicagoDay(new Date()),
    });
    revalidatePath(`/m/${key}`);
    if (result.ok && result.state) return { ok: true, state: result.state };
    return { ok: false, message: result.problem ? PROBLEM[result.problem] : copy.submit.gone };
  } catch (error) {
    console.error('Sending work in failed.', error);
    return { ok: false, message: copy.submit.failed };
  }
}

/** The plain two-tap "Done", for a task with no check (or one that turns out to have one). */
export async function finishTask(key: string, taskId: string, assignmentId?: string): Promise<SendResult> {
  return sendIn(key, taskId, assignmentId, '', '');
}

export async function takeTask(key: string, taskId: string): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member || !isUuid(taskId)) return;
  await claim(db, { taskId, memberId: member.id, today: chicagoDay(new Date()) });
  revalidatePath(`/m/${key}`);
}

export async function putBack(key: string, assignmentId: string): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member || !isUuid(assignmentId)) return;
  await giveBack(db, { assignmentId, memberId: member.id });
  revalidatePath(`/m/${key}`);
}
