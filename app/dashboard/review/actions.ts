'use server';

import { revalidatePath } from 'next/cache';
import { requireLead } from '@/lib/auth/session';
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { COMMENT_MAX, decide } from '@/lib/review';

export type ReviewState = { problem?: string };

/**
 * A lead's answer on one piece of waiting work. The button pressed says which:
 * its value is "approved" or "sent_back". Returns the reason in plain words
 * when it is refused; on success the card is gone when the page reloads.
 */
export async function decideAction(_previous: ReviewState, form: FormData): Promise<ReviewState> {
  const lead = await requireLead();
  const r = copy.review;
  const assignmentId = form.get('assignmentId');
  const decision = form.get('decision');
  if (!isUuid(assignmentId) || (decision !== 'approved' && decision !== 'sent_back')) return { problem: r.gone };
  const raw = form.get('comment');
  const comment = typeof raw === 'string' ? raw.trim() : '';
  if (comment.length > COMMENT_MAX) return { problem: r.commentLong };
  // Approving does not take a comment; whatever is typed in the box is dropped.
  const sent = decision === 'sent_back' ? comment : '';
  if (decision === 'sent_back' && sent === '') return { problem: r.commentNeeded };

  const result = await decide(getDb(), { assignmentId, decision, comment: sent, actorId: lead.id });
  // A refusal leaves the card where it is, so the lead can read why.
  if (!result.ok) return { problem: r.gone };
  revalidatePath('/dashboard/review');
  revalidatePath('/dashboard/finished');
  revalidatePath('/dashboard/tasks');
  return {};
}
