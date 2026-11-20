// Two things the check of phase 2 left open, each as a test.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, members, type Member } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { decide, reviewQueue } from '@/lib/review';
import { submitWork } from '@/lib/submit';
import { createTask, listTasks, openFor, publishTask, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const DAY = '2026-11-19';

describe('leftovers from the phase 2 check', () => {
  const getDb = useTestDb();
  let captain: Member;
  let lead: Member;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    const db = getDb();
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
  });

  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, captain.id);
    await publishTask(getDb(), task.id, captain.id);
    return task;
  };
  const line = async (member: Member, title: string) => (await openFor(getDb(), member.id, DAY)).find((h) => h.title === title);
  const counts = async (title: string) => {
    const row = (await listTasks(getDb())).find((t) => t.title === title)!;
    return { open: row.open, waiting: row.waiting, done: row.done };
  };
  const send = async (member: Member, title: string) => {
    const h = await line(member, title);
    return submitWork(getDb(), { taskId: h!.taskId, assignmentId: h!.assignmentId, memberId: member.id, note: 'did it', link: '', via: 'member_page', today: DAY });
  };
  const waiting = async (title: string) => (await reviewQueue(getDb())).find((r) => r.title === title)!;

  it("a deactivated member's own task is no longer counted as not done, and comes back when they do", async () => {
    const db = getDb();
    await published({ title: 'Own job, then away', audience: 'person', memberIds: [a.id] });
    expect(await counts('Own job, then away')).toEqual({ open: 1, waiting: 0, done: 0 });
    await setActive(db, a.id, false, captain.id);
    // Nobody can see or finish it now, so the task page must not say "1 not done".
    expect(await counts('Own job, then away')).toEqual({ open: 0, waiting: 0, done: 0 });
    await setActive(db, a.id, true, captain.id);
    expect(await counts('Own job, then away')).toEqual({ open: 1, waiting: 0, done: 0 });
    expect(await line(a, 'Own job, then away')).toBeDefined();
  });

  it('the same holds for work a lead sent back', async () => {
    const db = getDb();
    await published({ title: 'Sent back, then away', audience: 'person', memberIds: [a.id] });
    await send(a, 'Sent back, then away');
    const row = await waiting('Sent back, then away');
    expect((await decide(db, { assignmentId: row.assignmentId, decision: 'sent_back', comment: 'Redo the left side', actorId: lead.id })).ok).toBe(true);
    expect(await counts('Sent back, then away')).toEqual({ open: 1, waiting: 0, done: 0 });
    await setActive(db, a.id, false, captain.id);
    expect(await counts('Sent back, then away')).toEqual({ open: 0, waiting: 0, done: 0 });
    await setActive(db, a.id, true, captain.id);
    // Back on their list as a task to do. The earlier round stays in the record.
    expect(await counts('Sent back, then away')).toEqual({ open: 1, waiting: 0, done: 0 });
  });

  it('a task for two people keeps the other person when one is deactivated, and finished work is left alone', async () => {
    const db = getDb();
    await published({ title: 'Two people, each their own', audience: 'person', memberIds: [a.id, b.id], completion: 'each', needsCheck: false });
    await send(b, 'Two people, each their own');
    expect(await counts('Two people, each their own')).toEqual({ open: 1, waiting: 0, done: 1 });
    await setActive(db, a.id, false, captain.id);
    expect(await counts('Two people, each their own')).toEqual({ open: 0, waiting: 0, done: 1 });
    await setActive(db, b.id, false, captain.id);
    // What B finished stays finished.
    expect(await counts('Two people, each their own')).toEqual({ open: 0, waiting: 0, done: 1 });
    await setActive(db, a.id, true, captain.id);
    await setActive(db, b.id, true, captain.id);
    // A gets theirs back; B, who finished, is not asked again.
    expect(await counts('Two people, each their own')).toEqual({ open: 1, waiting: 0, done: 1 });
    expect(await line(b, 'Two people, each their own')).toBeUndefined();
  });

  it("a lead's answer waits for that lead's deactivation if one is under way, and is then refused", async () => {
    const db = getDb();
    await published({ title: 'Checked by a lead on the way out', audience: 'person', memberIds: [b.id] });
    await send(b, 'Checked by a lead on the way out');
    const row = await waiting('Checked by a lead on the way out');

    // A captain is deactivating the lead: the change is made but not yet final.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const underWay = new Promise<void>((resolve) => (started = resolve));
    const deactivation = db.transaction(async (tx) => {
      await tx.update(members).set({ active: false, deactivatedAt: new Date() }).where(eq(members.id, lead.id));
      started();
      await held;
    });
    await underWay;

    // The lead presses Approve at that moment.
    let settled = false;
    const answer = decide(db, { assignmentId: row.assignmentId, decision: 'approved', comment: '', actorId: lead.id }).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // It has not gone through on the lead's old standing: it is waiting.
    expect(settled).toBe(false);

    release();
    await deactivation;
    expect(await answer).toEqual({ ok: false });
    const [handout] = await db.select().from(assignments).where(eq(assignments.id, row.assignmentId));
    expect(handout.state).toBe('submitted');
    await setActive(db, lead.id, true, captain.id);
  });
});
