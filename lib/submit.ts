import { desc, eq } from 'drizzle-orm';
import type { Db } from './db/client';
import { assignments, submissions, tasks } from './db/schema';
import { LINK_MAX, NOTE_MAX } from './submit-limits';
import { finishHandout } from './tasks';

export { LINK_MAX, NOTE_MAX };
const STANDING_MAX = 20;

/** Why work was not taken. Only set when ok is false and the words were the problem. */
export type SubmitProblem = 'note_long' | 'link_bad' | 'link_long';

export type SubmitInput = {
  taskId: string;
  assignmentId?: string;
  memberId: string;
  note: string;
  link: string;
  via: 'kiosk' | 'member_page';
  today: string;
};

const length = (text: string) => [...text].length;

/**
 * A link is empty, or it starts with https:// and holds only plain visible
 * characters. That rules out spaces and control characters, and also the
 * invisible and right-to-left characters that can make a link read as one
 * address and lead to another. A real address with other letters in it can
 * always be written in this plain form.
 */
export function linkProblem(link: string): 'link_bad' | 'link_long' | null {
  if (link === '') return null;
  if (!/^https:\/\/[\x21-\x7e]+$/.test(link)) return 'link_bad';
  return length(link) > LINK_MAX ? 'link_long' : null;
}

/**
 * A member sends a hand-out in. One transaction: the hand-out is finished
 * (finishHandout, with the check on), and when that leaves it waiting for a
 * lead, one submissions row keeps the note and link. A task with the check
 * off goes straight to done and keeps no row. A refused note or link writes
 * nothing, so the hand-out stays on the member's list.
 */
export async function submitWork(
  db: Db,
  input: SubmitInput,
): Promise<{ ok: boolean; state?: 'submitted' | 'done'; problem?: SubmitProblem }> {
  const note = String(input.note ?? '').replace(/\u0000/g, '').trim();
  const link = String(input.link ?? '').trim();
  if (length(note) > NOTE_MAX) return { ok: false, problem: 'note_long' };
  const bad = linkProblem(link);
  if (bad) return { ok: false, problem: bad };

  return db.transaction(async (tx) => {
    const result = await finishHandout(tx, {
      taskId: input.taskId,
      assignmentId: input.assignmentId,
      memberId: input.memberId,
      via: input.via,
      today: input.today,
      check: true,
    });
    if (!result.ok || !result.assignmentId || !result.state) return { ok: false };
    if (result.state === 'submitted') {
      await tx.insert(submissions).values({
        assignmentId: result.assignmentId,
        memberId: input.memberId,
        note,
        link,
        via: input.via,
      });
    }
    return { ok: true, state: result.state };
  });
}

export type Standing = {
  assignmentId: string;
  title: string;
  state: 'waiting' | 'approved' | 'sent_back';
  note: string;
  link: string;
  /** What the lead wrote. Empty while it waits. */
  comment: string;
  at: Date;
};

/**
 * Where each piece of a member's sent-in work stands now, newest first, at
 * most 20. One row per hand-out: its newest round. Work a lead reopened, or
 * whose task was closed, is not listed: it is no longer waiting, approved or
 * sent back.
 */
export async function standingFor(db: Db, memberId: string): Promise<Standing[]> {
  const rows = await db
    .select({ s: submissions, title: tasks.title, state: assignments.state })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(tasks, eq(assignments.taskId, tasks.id))
    .where(eq(submissions.memberId, memberId))
    .orderBy(desc(submissions.createdAt), desc(submissions.id));
  const seen = new Set<string>();
  const out: Standing[] = [];
  for (const { s, title, state } of rows) {
    if (seen.has(s.assignmentId)) continue;
    seen.add(s.assignmentId);
    const now =
      state === 'submitted' && s.decision === null
        ? 'waiting'
        : state === 'approved' && s.decision === 'approved'
          ? 'approved'
          : state === 'sent_back' && s.decision === 'sent_back'
            ? 'sent_back'
            : null;
    if (!now) continue;
    out.push({ assignmentId: s.assignmentId, title, state: now, note: s.note, link: s.link, comment: s.decision ? s.comment : '', at: s.createdAt });
    if (out.length === STANDING_MAX) break;
  }
  return out;
}
