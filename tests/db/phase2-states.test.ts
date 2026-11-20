// Phase 2 groundwork: the states a hand-out moves through once a lead checks
// finished work. The screens are built on these by the lanes.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, submissions, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam } from '@/lib/members';
import {
  createTask,
  finishHandout,
  finished,
  listTasks,
  membersWithNothing,
  openFor,
  publishTask,
  reopen,
  settleReview,
  updateTask,
  type TaskInput,
} from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';

describe('phase 2 states', () => {
  const getDb = useTestDb();
  let lead: Member;
  let a: Member;
  let b: Member;
  let build: Subteam;

  beforeAll(async () => {
    const db = getDb();
    build = await addSubteam(db, 'Build');
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamIds: [build.id] }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamIds: [build.id] }, null);
  });

  const line = async (member: Member, title: string) => (await openFor(getDb(), member.id, TODAY)).find((h) => h.title === title);
  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };
  const finish = (taskId: string, assignmentId: string | undefined, member: Member) =>
    getDb().transaction((tx) => finishHandout(tx, { taskId, assignmentId, memberId: member.id, via: 'member_page', today: TODAY, check: true }));

  it('a task that needs a check goes to "submitted" and leaves the list; one that does not goes straight to done', async () => {
    const checked = await published({ title: 'Needs a check', audience: 'person', memberIds: [a.id] });
    const plain = await published({ title: 'No check', audience: 'person', memberIds: [a.id], needsCheck: false });
    expect((await line(a, 'Needs a check'))?.needsCheck).toBe(true);
    const first = await finish(checked.id, (await line(a, 'Needs a check'))!.assignmentId, a);
    expect(first).toMatchObject({ ok: true, state: 'submitted' });
    expect(first.assignmentId).toBeTruthy();
    const second = await finish(plain.id, (await line(a, 'No check'))!.assignmentId, a);
    expect(second).toMatchObject({ ok: true, state: 'done' });
    expect(await line(a, 'Needs a check')).toBeUndefined();
    expect(await line(a, 'No check')).toBeUndefined();
    // Waiting work is not "finished" yet.
    const titles = (await finished(getDb(), { limit: 100 })).map((f) => f.title);
    expect(titles).toContain('No check');
    expect(titles).not.toContain('Needs a check');
  });

  it('approving finishes it; sending it back puts it on the member\'s list again with the comment', async () => {
    const db = getDb();
    const task = await published({ title: 'Sent back once', audience: 'person', memberIds: [a.id] });
    const sent = await finish(task.id, (await line(a, 'Sent back once'))!.assignmentId, a);
    // The review code writes the submission row; here it is done by hand.
    const [submission] = await db
      .insert(submissions)
      .values({ assignmentId: sent.assignmentId!, memberId: a.id, note: 'Did it', via: 'member_page' })
      .returning();
    expect((await db.transaction((tx) => settleReview(tx, { assignmentId: sent.assignmentId!, decision: 'sent_back' }))).ok).toBe(true);
    await db
      .update(submissions)
      .set({ decision: 'sent_back', comment: 'Two bolts are loose', reviewedById: lead.id, reviewedAt: new Date() })
      .where(eq(submissions.id, submission.id));
    const back = await line(a, 'Sent back once');
    expect(back).toMatchObject({ state: 'sent_back', sentBackComment: 'Two bolts are loose', group: 'yours' });
    // Sent again, then approved.
    const again = await finish(task.id, back!.assignmentId, a);
    expect(again.state).toBe('submitted');
    expect((await db.transaction((tx) => settleReview(tx, { assignmentId: again.assignmentId!, decision: 'approved' }))).ok).toBe(true);
    expect(await line(a, 'Sent back once')).toBeUndefined();
    expect((await finished(db, { limit: 100 })).map((f) => f.title)).toContain('Sent back once');
    // A decision on something that is not waiting does nothing.
    expect((await db.transaction((tx) => settleReview(tx, { assignmentId: again.assignmentId!, decision: 'sent_back' }))).ok).toBe(false);
  });

  it('work waiting for a check is not handed out again by an edit, and counts in the task list', async () => {
    const db = getDb();
    const task = await published({ title: 'Waiting then edited', audience: 'person', memberIds: [a.id, b.id], completion: 'each' });
    await finish(task.id, (await line(a, 'Waiting then edited'))!.assignmentId, a);
    await updateTask(db, task.id, { title: 'Waiting then edited', description: 'typo fixed', audience: 'person', memberIds: [a.id, b.id], completion: 'each' }, lead.id);
    expect(await line(a, 'Waiting then edited')).toBeUndefined();
    expect(await line(b, 'Waiting then edited')).toBeDefined();
    const row = (await listTasks(db)).find((t) => t.title === 'Waiting then edited');
    expect(row).toMatchObject({ open: 1, waiting: 1, done: 0 });
  });

  it('"done once for the group" waiting for a check is off everyone\'s list', async () => {
    const task = await published({ title: 'Once and waiting', audience: 'person', memberIds: [a.id, b.id] });
    await finish(task.id, (await line(a, 'Once and waiting'))!.assignmentId, a);
    expect(await line(b, 'Once and waiting')).toBeUndefined();
    const rows = await getDb().select().from(assignments).where(eq(assignments.taskId, task.id));
    expect(rows.map((r) => r.state).sort()).toEqual(['closed', 'submitted']);
  });

  it('a lead can reopen approved work, and someone whose only work is waiting shows as having no task', async () => {
    const db = getDb();
    const solo = await addMember(db, { firstName: 'Solo', lastName: 'Waiter' }, null);
    const task = await published({ title: 'Approved then reopened', audience: 'person', memberIds: [solo.id] });
    const sent = await finish(task.id, (await line(solo, 'Approved then reopened'))!.assignmentId, solo);
    expect((await membersWithNothing(db, TODAY)).map((m) => m.memberId)).toContain(solo.id);
    await db.transaction((tx) => settleReview(tx, { assignmentId: sent.assignmentId!, decision: 'approved' }));
    await reopen(db, sent.assignmentId!, lead.id);
    expect((await line(solo, 'Approved then reopened'))?.state).toBe('open');
  });
});
