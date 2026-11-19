// The leads' review queue: what waits, and a lead's answer.
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, changeLog, submissions, type Member } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { approvals, decide, reviewQueue } from '@/lib/review';
import { createTask, finishHandout, finished, openFor, publishTask, reopen, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';

describe('review queue', () => {
  const getDb = useTestDb();
  let lead: Member;
  let lead2: Member;
  let captain: Member;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    const db = getDb();
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead One', role: 'lead' }, null);
    lead2 = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
  });

  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };

  /** A task for `member`, finished with a check and a submissions row, so it waits. */
  async function waiting(member: Member, title: string, extra: { note?: string; link?: string; via?: 'kiosk' | 'member_page'; at?: Date } = {}) {
    const task = await published({ title, audience: 'person', memberIds: [member.id] });
    const line = (await openFor(getDb(), member.id, TODAY)).find((h) => h.title === title)!;
    return sendIn(member, task.id, line.assignmentId, extra);
  }

  async function sendIn(
    member: Member,
    taskId: string,
    assignmentId: string | undefined,
    extra: { note?: string; link?: string; via?: 'kiosk' | 'member_page'; at?: Date } = {},
  ) {
    return getDb().transaction(async (tx) => {
      const done = await finishHandout(tx, { taskId, assignmentId, memberId: member.id, via: extra.via ?? 'member_page', today: TODAY, check: true });
      expect(done).toMatchObject({ ok: true, state: 'submitted' });
      const [row] = await tx
        .insert(submissions)
        .values({
          assignmentId: done.assignmentId!,
          memberId: member.id,
          note: extra.note ?? '',
          link: extra.link ?? '',
          via: extra.via ?? 'member_page',
          ...(extra.at ? { createdAt: extra.at } : {}),
        })
        .returning();
      return { taskId, assignmentId: done.assignmentId!, submissionId: row.id };
    });
  }

  const stateOf = async (assignmentId: string) => (await getDb().select().from(assignments).where(eq(assignments.id, assignmentId)))[0].state;
  const subOf = async (id: string) => (await getDb().select().from(submissions).where(eq(submissions.id, id)))[0];
  const queueIds = async () => (await reviewQueue(getDb())).map((r) => r.assignmentId);

  it('lists waiting work oldest first, with the whole name, note, link and how it was sent', async () => {
    const newer = await waiting(a, 'Queue newer', { note: 'second', at: new Date('2026-11-19T15:00:00Z') });
    const older = await waiting(b, 'Queue older', {
      note: 'first',
      link: 'https://example.com/photo',
      via: 'kiosk',
      at: new Date('2026-11-19T14:00:00Z'),
    });
    const rows = await reviewQueue(getDb());
    const mine = rows.filter((r) => r.assignmentId === older.assignmentId || r.assignmentId === newer.assignmentId);
    expect(mine.map((r) => r.title)).toEqual(['Queue older', 'Queue newer']);
    expect(mine[0]).toMatchObject({
      assignmentId: older.assignmentId,
      submissionId: older.submissionId,
      taskId: older.taskId,
      member: 'Test Member B',
      note: 'first',
      link: 'https://example.com/photo',
      via: 'kiosk',
    });
    expect(mine[0].at).toEqual(new Date('2026-11-19T14:00:00Z'));
    expect(mine[1]).toMatchObject({ member: 'Test Member A', via: 'member_page', link: '' });
  });

  it('does not list work that is not waiting: finished without a check, or still on a list', async () => {
    const plain = await published({ title: 'Queue no check', audience: 'person', memberIds: [a.id], needsCheck: false });
    const line = (await openFor(getDb(), a.id, TODAY)).find((h) => h.title === 'Queue no check')!;
    await getDb().transaction((tx) => finishHandout(tx, { taskId: plain.id, assignmentId: line.assignmentId, memberId: a.id, via: 'member_page', today: TODAY, check: true }));
    await published({ title: 'Queue still open', audience: 'person', memberIds: [a.id] });
    const titles = (await reviewQueue(getDb())).map((r) => r.title);
    expect(titles).not.toContain('Queue no check');
    expect(titles).not.toContain('Queue still open');
  });

  it('approve moves the hand-out to approved and writes who, when and the decision on the submission', async () => {
    const w = await waiting(a, 'Approve me', { note: 'done' });
    const before = Date.now();
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: lead.id })).toEqual({ ok: true });
    expect(await stateOf(w.assignmentId)).toBe('approved');
    const sub = await subOf(w.submissionId);
    expect(sub).toMatchObject({ decision: 'approved', comment: '', reviewedById: lead.id });
    expect(sub.reviewedAt!.getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(await queueIds()).not.toContain(w.assignmentId);
  });

  it('a captain can decide too', async () => {
    const w = await waiting(b, 'Captain approves');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: captain.id })).toEqual({ ok: true });
    expect(await subOf(w.submissionId)).toMatchObject({ reviewedById: captain.id });
  });

  it('send back needs a comment: empty or spaces only is refused and nothing changes', async () => {
    const w = await waiting(a, 'Send back empty');
    for (const comment of ['', '   ', '\n\t ']) {
      expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment, actorId: lead.id })).toEqual({ ok: false });
    }
    expect(await stateOf(w.assignmentId)).toBe('submitted');
    expect(await subOf(w.submissionId)).toMatchObject({ decision: null, reviewedById: null, reviewedAt: null });
    expect(await queueIds()).toContain(w.assignmentId);
  });

  it('send back with a comment puts the task on the member list again, with the comment', async () => {
    const w = await waiting(a, 'Send back me');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: '  Redo the wiring.  ', actorId: lead.id })).toEqual({ ok: true });
    expect(await stateOf(w.assignmentId)).toBe('sent_back');
    expect(await subOf(w.submissionId)).toMatchObject({ decision: 'sent_back', comment: 'Redo the wiring.', reviewedById: lead.id });
    const line = (await openFor(getDb(), a.id, TODAY)).find((h) => h.title === 'Send back me');
    expect(line).toMatchObject({ state: 'sent_back', sentBackComment: 'Redo the wiring.' });
    expect(await queueIds()).not.toContain(w.assignmentId);
  });

  it('a comment over 500 characters is refused; exactly 500 is fine', async () => {
    const w = await waiting(a, 'Long comment');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: 'x'.repeat(501), actorId: lead.id })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: 'x'.repeat(10_000), actorId: lead.id })).toEqual({ ok: false });
    expect(await stateOf(w.assignmentId)).toBe('submitted');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: 'x'.repeat(500), actorId: lead.id })).toEqual({ ok: true });
  });

  it('a plain member cannot decide, even on their own work, and nothing changes', async () => {
    const w = await waiting(a, 'Member decides');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: a.id })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: b.id })).toEqual({ ok: false });
    expect(await stateOf(w.assignmentId)).toBe('submitted');
    expect(await subOf(w.submissionId)).toMatchObject({ decision: null });
  });

  it('a lead who was deactivated, or an actor who does not exist, cannot decide', async () => {
    const gone = await addMember(getDb(), { firstName: 'Test', lastName: 'Gone Lead', role: 'lead' }, null);
    const w = await waiting(a, 'Deactivated decides');
    await setActive(getDb(), gone.id, false, lead.id);
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: gone.id })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: '00000000-0000-4000-8000-000000000000' })).toEqual({ ok: false });
    expect(await stateOf(w.assignmentId)).toBe('submitted');
    expect(await subOf(w.submissionId)).toMatchObject({ decision: null });
  });

  it('junk ids and an unknown hand-out give ok:false and no error', async () => {
    expect(await decide(getDb(), { assignmentId: 'nope', decision: 'approved', comment: '', actorId: lead.id })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: '00000000-0000-4000-8000-000000000000', decision: 'approved', comment: '', actorId: lead.id })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: '00000000-0000-4000-8000-000000000000', decision: 'approved', comment: '', actorId: 'nope' })).toEqual({ ok: false });
    expect(await decide(getDb(), { assignmentId: '00000000-0000-4000-8000-000000000000', decision: 'maybe' as never, comment: '', actorId: lead.id })).toEqual({ ok: false });
  });

  it('deciding the same work twice: the second is ok:false and the first answer stays', async () => {
    const w = await waiting(a, 'Decide twice');
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: lead.id })).toEqual({ ok: true });
    expect(await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: 'Changed my mind', actorId: lead2.id })).toEqual({ ok: false });
    expect(await stateOf(w.assignmentId)).toBe('approved');
    expect(await subOf(w.submissionId)).toMatchObject({ decision: 'approved', reviewedById: lead.id, comment: '' });
  });

  it('two leads deciding the same work at once: exactly one ok, one decision written', async () => {
    const w = await waiting(b, 'Race');
    const results = await Promise.all([
      decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: lead.id }),
      decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: 'Not yet', actorId: lead2.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const logged = await getDb().select().from(changeLog).where(and(eq(changeLog.entityId, w.assignmentId), eq(changeLog.entity, 'assignment')));
    expect(logged.filter((l) => l.action.startsWith('review.'))).toHaveLength(1);
    const sub = await subOf(w.submissionId);
    expect(sub.decision).not.toBeNull();
    expect(await stateOf(w.assignmentId)).toBe(sub.decision);
  });

  it('every decision writes a change_log row naming the lead', async () => {
    const w1 = await waiting(a, 'Log approve');
    const w2 = await waiting(a, 'Log send back');
    await decide(getDb(), { assignmentId: w1.assignmentId, decision: 'approved', comment: '', actorId: lead.id });
    await decide(getDb(), { assignmentId: w2.assignmentId, decision: 'sent_back', comment: 'Again', actorId: lead2.id });
    const rows = await getDb().select().from(changeLog).where(eq(changeLog.entity, 'assignment'));
    const one = rows.find((r) => r.entityId === w1.assignmentId && r.action === 'review.approved');
    const two = rows.find((r) => r.entityId === w2.assignmentId && r.action === 'review.sent_back');
    expect(one?.actorId).toBe(lead.id);
    expect(two?.actorId).toBe(lead2.id);
    expect(one?.detail).toMatchObject({ taskId: w1.taskId, submissionId: w1.submissionId });
    // The comment is the member's business and the lead's, not the log's.
    expect(JSON.stringify(two?.detail)).not.toContain('Again');
  });

  it('a refused decision writes no log row', async () => {
    const w = await waiting(a, 'Refused no log');
    await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: ' ', actorId: lead.id });
    await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: a.id });
    const rows = await getDb().select().from(changeLog).where(eq(changeLog.entityId, w.assignmentId));
    expect(rows.filter((r) => r.action.startsWith('review.'))).toHaveLength(0);
  });

  it('work sent back and sent in again shows once, with its newest note', async () => {
    const w = await waiting(a, 'Again and again', { note: 'first try', at: new Date('2026-11-19T10:00:00Z') });
    await decide(getDb(), { assignmentId: w.assignmentId, decision: 'sent_back', comment: 'Try once more', actorId: lead.id });
    const line = (await openFor(getDb(), a.id, TODAY)).find((h) => h.title === 'Again and again')!;
    expect(line.assignmentId).toBe(w.assignmentId);
    const second = await sendIn(a, w.taskId, line.assignmentId, { note: 'second try', at: new Date('2026-11-19T11:00:00Z') });
    const rows = (await reviewQueue(getDb())).filter((r) => r.assignmentId === w.assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ note: 'second try', submissionId: second.submissionId });
    // The answer lands on the newest submission only; the old one keeps its own.
    await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: lead.id });
    expect(await subOf(second.submissionId)).toMatchObject({ decision: 'approved' });
    expect(await subOf(w.submissionId)).toMatchObject({ decision: 'sent_back', comment: 'Try once more' });
  });

  it('a hand-out that is waiting but has no submission row is not in the queue and cannot be decided', async () => {
    const task = await published({ title: 'No row', audience: 'person', memberIds: [b.id] });
    const line = (await openFor(getDb(), b.id, TODAY)).find((h) => h.title === 'No row')!;
    const done = await getDb().transaction((tx) => finishHandout(tx, { taskId: task.id, assignmentId: line.assignmentId, memberId: b.id, via: 'member_page', today: TODAY, check: true }));
    expect(await queueIds()).not.toContain(done.assignmentId);
    expect(await decide(getDb(), { assignmentId: done.assignmentId!, decision: 'approved', comment: '', actorId: lead.id })).toEqual({ ok: false });
    expect(await stateOf(done.assignmentId!)).toBe('submitted');
  });

  it('approvals tells who approved: only for work that is approved now', async () => {
    const ok = await waiting(a, 'Approvals ok');
    const back = await waiting(a, 'Approvals sent back');
    const waits = await waiting(b, 'Approvals waiting');
    await decide(getDb(), { assignmentId: ok.assignmentId, decision: 'approved', comment: '', actorId: lead2.id });
    await decide(getDb(), { assignmentId: back.assignmentId, decision: 'sent_back', comment: 'No', actorId: lead.id });
    const got = await approvals(getDb(), [ok.assignmentId, back.assignmentId, waits.assignmentId, 'junk']);
    expect([...got.keys()]).toEqual([ok.assignmentId]);
    expect(got.get(ok.assignmentId)).toMatchObject({ by: 'Test Lead Two' });
    expect(got.get(ok.assignmentId)!.at).toBeInstanceOf(Date);
    expect((await finished(getDb(), { limit: 100 })).map((f) => f.assignmentId)).toContain(ok.assignmentId);
    expect((await approvals(getDb(), [])).size).toBe(0);
  });

  it('approved work that a lead reopened and that was then finished with no check is no longer shown as approved', async () => {
    const task = await published({ title: 'Approved then redone', audience: 'person', memberIds: [a.id] });
    const line = (await openFor(getDb(), a.id, TODAY)).find((h) => h.title === 'Approved then redone')!;
    const w = await sendIn(a, task.id, line.assignmentId);
    await decide(getDb(), { assignmentId: w.assignmentId, decision: 'approved', comment: '', actorId: lead.id });
    expect((await approvals(getDb(), [w.assignmentId])).has(w.assignmentId)).toBe(true);
    await reopen(getDb(), w.assignmentId, lead.id);
    expect((await approvals(getDb(), [w.assignmentId])).has(w.assignmentId)).toBe(false);
    await getDb().transaction((tx) => finishHandout(tx, { taskId: task.id, assignmentId: w.assignmentId, memberId: a.id, via: 'member_page', today: TODAY, check: false }));
    expect(await stateOf(w.assignmentId)).toBe('done');
    expect((await approvals(getDb(), [w.assignmentId])).has(w.assignmentId)).toBe(false);
  });
});
