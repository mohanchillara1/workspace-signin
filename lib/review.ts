import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from './db/client';
import { assignments, members, submissions, tasks } from './db/schema';
import { isUuid } from './ids';
import { logChange } from './log';
import { settleReview } from './tasks';

export const COMMENT_MAX = 500;

/** Thrown inside decide() to roll the transaction back. */
class Nothing extends Error {}

/** One piece of work waiting for a lead. For the leads' dashboard only, so the whole name. */
export type ReviewRow = {
  assignmentId: string;
  submissionId: string;
  taskId: string;
  title: string;
  member: string;
  note: string;
  link: string;
  via: 'kiosk' | 'member_page' | 'lead';
  at: Date;
  /** 1 the first time it is sent in, 2 after one send-back, and so on. */
  round: number;
  /** What a lead wrote the last time it was sent back. Empty on the first round. */
  lastComment: string;
};

/**
 * Work waiting for a lead, oldest first. A hand-out that was sent back and
 * sent in again is listed once, with its newest note.
 */
export async function reviewQueue(db: Db): Promise<ReviewRow[]> {
  const rows = await db
    .select({
      assignmentId: assignments.id,
      submissionId: submissions.id,
      taskId: tasks.id,
      title: tasks.title,
      first: members.firstName,
      last: members.lastName,
      note: submissions.note,
      link: submissions.link,
      via: submissions.via,
      at: submissions.createdAt,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .innerJoin(members, eq(submissions.memberId, members.id))
    .where(and(eq(assignments.state, 'submitted'), isNull(submissions.decision)))
    // Newest first, so the first row seen for a hand-out is the one to show.
    .orderBy(desc(submissions.createdAt), desc(submissions.id));
  const seen = new Set<string>();
  const newest = rows.filter((r) => (seen.has(r.assignmentId) ? false : (seen.add(r.assignmentId), true)));
  // Earlier rounds of the same work: how many, and what was said last time.
  const rounds = new Map<string, { count: number; lastComment: string }>();
  if (newest.length) {
    const earlier = await db
      .select({ assignmentId: submissions.assignmentId, decision: submissions.decision, comment: submissions.comment })
      .from(submissions)
      .where(inArray(submissions.assignmentId, newest.map((r) => r.assignmentId)))
      .orderBy(submissions.createdAt, submissions.id);
    for (const e of earlier) {
      const entry = rounds.get(e.assignmentId) ?? { count: 0, lastComment: '' };
      entry.count++;
      if (e.decision === 'sent_back') entry.lastComment = e.comment;
      rounds.set(e.assignmentId, entry);
    }
  }
  return newest
    .map(({ first, last, ...r }) => ({
      ...r,
      member: `${first} ${last}`.trim(),
      round: rounds.get(r.assignmentId)?.count ?? 1,
      lastComment: rounds.get(r.assignmentId)?.lastComment ?? '',
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime() || (x.submissionId < y.submissionId ? -1 : 1));
}

/**
 * A lead's answer on waiting work. One transaction: the actor must be an
 * active lead or captain, the hand-out must still be waiting, and the answer
 * lands on its newest waiting submission. A send-back needs a comment.
 * Anything refused changes nothing.
 */
export async function decide(
  db: Db,
  input: { assignmentId: string; decision: 'approved' | 'sent_back'; comment: string; actorId: string },
): Promise<{ ok: boolean; reason?: 'own_work' }> {
  const { assignmentId, decision, actorId } = input;
  if (!isUuid(assignmentId) || !isUuid(actorId)) return { ok: false };
  if (decision !== 'approved' && decision !== 'sent_back') return { ok: false };
  // Control characters have no place in a comment, and one of them (NUL) cannot be stored at all.
  const comment = typeof input.comment === 'string' ? input.comment.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
  if (comment.length > COMMENT_MAX) return { ok: false };
  if (decision === 'sent_back' && comment === '') return { ok: false };

  return db.transaction(async (tx) => {
    // "for share": if the actor is being deactivated right now, this waits for it.
    const [actor] = await tx.select().from(members).where(eq(members.id, actorId)).for('share');
    if (!actor || !actor.active || (actor.role !== 'lead' && actor.role !== 'captain')) return { ok: false };

    const [sub] = await tx
      .select({ id: submissions.id, memberId: submissions.memberId })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), isNull(submissions.decision)))
      .orderBy(desc(submissions.createdAt), desc(submissions.id))
      .limit(1);
    if (!sub) return { ok: false };
    // A check by the person who did the work is no check. Another lead answers it.
    if (sub.memberId === actor.id) return { ok: false, reason: 'own_work' as const };

    const settled = await settleReview(tx, { assignmentId, decision });
    if (!settled.ok) return { ok: false };
    await tx
      .update(submissions)
      .set({ decision, comment, reviewedById: actor.id, reviewedAt: new Date() })
      .where(eq(submissions.id, sub.id));
    await logChange(tx, {
      actorId: actor.id,
      action: `review.${decision}`,
      entity: 'assignment',
      entityId: assignmentId,
      // The comment stays on the submission; the log holds who, what and which.
      detail: { taskId: settled.taskId, submissionId: sub.id },
    });
    return { ok: true };
  }).catch((error: unknown) => {
    if (error instanceof Nothing) return { ok: false };
    throw error;
  });
}

/**
 * Who approved each of these hand-outs, for the Finished list. Only hand-outs
 * that are approved right now appear: one a lead reopened, or that was later
 * finished without a check, does not. `by` is empty if no lead is on record.
 */
export async function approvals(db: Db, assignmentIds: string[]): Promise<Map<string, { by: string; at: Date | null }>> {
  const ids = assignmentIds.filter(isUuid);
  const result = new Map<string, { by: string; at: Date | null }>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({ assignmentId: assignments.id, first: members.firstName, last: members.lastName, at: submissions.reviewedAt })
    .from(assignments)
    .leftJoin(
      submissions,
      and(eq(submissions.assignmentId, assignments.id), eq(submissions.decision, 'approved')),
    )
    .leftJoin(members, eq(submissions.reviewedById, members.id))
    .where(and(inArray(assignments.id, ids), eq(assignments.state, 'approved')))
    // Newest approval last, so it wins below.
    .orderBy(submissions.reviewedAt);
  for (const r of rows) result.set(r.assignmentId, { by: r.first ? `${r.first} ${r.last ?? ''}`.trim() : '', at: r.at });
  return result;
}
