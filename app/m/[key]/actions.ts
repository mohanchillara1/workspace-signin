'use server';

import { revalidatePath } from 'next/cache';
import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { memberByPageKey } from '@/lib/members';
import { claim, markDone, setStepsDone } from '@/lib/tasks';

// The page key is the member's only credential, so every action starts by
// looking the member up from it again.

export async function tickSteps(key: string, assignmentId: string, stepsDone: number[]): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member || !Array.isArray(stepsDone)) return;
  await setStepsDone(db, { assignmentId, memberId: member.id, stepsDone });
  revalidatePath(`/m/${key}`);
}

export async function finishTask(key: string, taskId: string, assignmentId?: string): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member) return;
  await markDone(db, { taskId, assignmentId, memberId: member.id, via: 'member_page', today: chicagoDay(new Date()) });
  revalidatePath(`/m/${key}`);
}

export async function takeTask(key: string, taskId: string): Promise<void> {
  const db = getDb();
  const member = await memberByPageKey(db, key);
  if (!member) return;
  await claim(db, { taskId, memberId: member.id, today: chicagoDay(new Date()) });
  revalidatePath(`/m/${key}`);
}
