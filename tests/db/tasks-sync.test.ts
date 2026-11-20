// Faults found by the phase 1 review: hand-outs have to follow edits, moves
// between subteams and deactivations, and hold up when two things happen at
// the same moment.
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, tasks, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam, setActive, updateMember } from '@/lib/members';
import {
  claim,
  closeTask,
  createTask,
  finished,
  giveBack,
  markDone,
  openFor,
  publishTask,
  release,
  reopen,
  updateTask,
  type TaskInput,
} from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';

describe('hand-outs follow edits, moves and races', () => {
  const getDb = useTestDb();
  let lead: Member;
  let a: Member;
  let b: Member;
  let c: Member;
  let build: Subteam;
  let code: Subteam;

  beforeAll(async () => {
    const db = getDb();
    build = await addSubteam(db, 'Build');
    code = await addSubteam(db, 'Code');
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamIds: [build.id] }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamIds: [build.id] }, null);
    c = await addMember(db, { firstName: 'Test', lastName: 'Member C', subteamIds: [code.id] }, null);
  });

  const lines = async (member: Member, title: string, day = TODAY) =>
    (await openFor(getDb(), member.id, day)).filter((h) => h.title === title);
  const rowsOf = (taskId: string) => getDb().select().from(assignments).where(eq(assignments.taskId, taskId));
  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };

  it('three publishes at once make one pool hand-out, and a claim then works', async () => {
    const db = getDb();
    const task = await createTask(db, { title: 'Published three times', audience: 'pool' }, lead.id);
    await Promise.all([publishTask(db, task.id, lead.id), publishTask(db, task.id, lead.id), publishTask(db, task.id, lead.id)]);
    expect(await rowsOf(task.id)).toHaveLength(1);
    expect(await lines(a, 'Published three times')).toHaveLength(1);
    expect((await claim(db, { taskId: task.id, memberId: a.id, today: TODAY })).ok).toBe(true);
    expect((await claim(db, { taskId: task.id, memberId: b.id, today: TODAY })).ok).toBe(false);
  });

  it('a publish that fails leaves the task a draft with no hand-outs', async () => {
    const db = getDb();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const task = await createTask(db, { title: 'For nobody real', audience: 'person', memberIds: [ghost] }, lead.id);
    await expect(publishTask(db, task.id, lead.id)).rejects.toThrow();
    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after.state).toBe('draft');
    expect(await rowsOf(task.id)).toHaveLength(0);
  });

  it('taking a person off a published task takes it off their list; adding one gives it', async () => {
    const db = getDb();
    const task = await published({ title: 'Swap people', audience: 'person', memberIds: [a.id], completion: 'each' });
    await updateTask(db, task.id, { title: 'Swap people', audience: 'person', memberIds: [b.id], completion: 'each' }, lead.id);
    expect(await lines(a, 'Swap people')).toHaveLength(0);
    expect(await lines(b, 'Swap people')).toHaveLength(1);
    // Putting A back gives one line, not two.
    await updateTask(db, task.id, { title: 'Swap people', audience: 'person', memberIds: [a.id, b.id], completion: 'each' }, lead.id);
    expect(await lines(a, 'Swap people')).toHaveLength(1);
    expect(await lines(b, 'Swap people')).toHaveLength(1);
  });

  it('an edit does not hand a finished task out again', async () => {
    const db = getDb();
    const task = await published({ title: 'Already done', audience: 'person', memberIds: [a.id, b.id] });
    const [mine] = await lines(a, 'Already done');
    await markDone(db, { taskId: task.id, assignmentId: mine.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    await updateTask(db, task.id, { title: 'Already done', description: 'A lead fixed a typo', audience: 'person', memberIds: [a.id, b.id] }, lead.id);
    expect(await lines(a, 'Already done')).toHaveLength(0);
    expect(await lines(b, 'Already done')).toHaveLength(0);
  });

  it('moving a subteam task to another subteam moves it', async () => {
    const db = getDb();
    const task = await published({ title: 'Moves teams', audience: 'subteam', subteamId: build.id });
    await updateTask(db, task.id, { title: 'Moves teams', audience: 'subteam', subteamId: code.id }, lead.id);
    expect(await lines(a, 'Moves teams')).toHaveLength(0);
    expect(await lines(c, 'Moves teams')).toHaveLength(1);
  });

  it('changing "done once" to "everyone does their own" shows one line each, never two', async () => {
    const db = getDb();
    const task = await published({ title: 'Once then each', audience: 'subteam', subteamId: build.id });
    await updateTask(db, task.id, { title: 'Once then each', audience: 'subteam', subteamId: build.id, completion: 'each' }, lead.id);
    expect(await lines(a, 'Once then each')).toHaveLength(1);
    expect(await lines(b, 'Once then each')).toHaveLength(1);
    await updateTask(db, task.id, { title: 'Once then each', audience: 'subteam', subteamId: build.id, completion: 'once' }, lead.id);
    expect(await lines(a, 'Once then each')).toHaveLength(1);
  });

  it('turning a pool task into a standing one, and back, shows one line', async () => {
    const db = getDb();
    const task = await published({ title: 'Pool then standing', audience: 'pool' });
    await updateTask(db, task.id, { title: 'Pool then standing', audience: 'pool', standing: true }, lead.id);
    expect(await lines(a, 'Pool then standing')).toHaveLength(1);
    await updateTask(db, task.id, { title: 'Pool then standing', audience: 'pool', standing: false }, lead.id);
    expect(await lines(a, 'Pool then standing')).toHaveLength(1);
  });

  it('someone who joins a subteam later gets its "everyone does their own" tasks, and someone who leaves loses them', async () => {
    const db = getDb();
    await published({ title: 'Each for Build', audience: 'subteam', subteamId: build.id, completion: 'each' });
    const late = await addMember(db, { firstName: 'Late', lastName: 'Joiner', subteamIds: [build.id] }, lead.id);
    expect(await lines(late, 'Each for Build')).toHaveLength(1);
    const mover = await addMember(db, { firstName: 'Mover', lastName: 'Person', subteamIds: [code.id] }, lead.id);
    expect(await lines(mover, 'Each for Build')).toHaveLength(0);
    await updateMember(db, mover.id, { subteamIds: [build.id] }, lead.id);
    expect(await lines(mover, 'Each for Build')).toHaveLength(1);
    await updateMember(db, mover.id, { subteamIds: [code.id] }, lead.id);
    expect(await lines(mover, 'Each for Build')).toHaveLength(0);
    // Moving back does not make a second copy.
    await updateMember(db, mover.id, { subteamIds: [build.id] }, lead.id);
    expect(await lines(mover, 'Each for Build')).toHaveLength(1);
  });

  it('a pool task held by someone who is deactivated goes back to the pool', async () => {
    const db = getDb();
    const holder = await addMember(db, { firstName: 'Holder', lastName: 'Person' }, lead.id);
    const task = await published({ title: 'Held then freed', audience: 'pool' });
    await claim(db, { taskId: task.id, memberId: holder.id, today: TODAY });
    expect(await lines(a, 'Held then freed')).toHaveLength(0);
    await setActive(db, holder.id, false, lead.id);
    const [back] = await lines(a, 'Held then freed');
    expect(back?.group).toBe('pool');
    // A deactivated member cannot take anything.
    expect((await claim(db, { taskId: task.id, memberId: holder.id, today: TODAY })).ok).toBe(false);
  });

  it('a "done once" task finished by two people at the same moment is done once', async () => {
    const db = getDb();
    for (let round = 0; round < 8; round++) {
      const title = `Raced finish ${round}`;
      const task = await published({ title, audience: 'person', memberIds: [a.id, b.id] });
      const [forA] = await lines(a, title);
      const [forB] = await lines(b, title);
      const results = await Promise.all([
        markDone(db, { taskId: task.id, assignmentId: forA.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY }),
        markDone(db, { taskId: task.id, assignmentId: forB.assignmentId, memberId: b.id, via: 'kiosk', today: TODAY }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const done = await db.select().from(assignments).where(and(eq(assignments.taskId, task.id), eq(assignments.state, 'done')));
      expect(done).toHaveLength(1);
    }
  });

  it('taking a task back after it is done changes nothing', async () => {
    const db = getDb();
    const task = await published({ title: 'Done then released', audience: 'pool' });
    await claim(db, { taskId: task.id, memberId: a.id, today: TODAY });
    const [mine] = await lines(a, 'Done then released');
    await markDone(db, { taskId: task.id, assignmentId: mine.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    await release(db, mine.assignmentId!, lead.id);
    const [row] = await rowsOf(task.id);
    expect(row.state).toBe('done');
    expect(await lines(b, 'Done then released')).toHaveLength(0);
  });

  it('a member can put back a task they took, and nobody else can', async () => {
    const db = getDb();
    const task = await published({ title: 'Taken by mistake', audience: 'pool' });
    await claim(db, { taskId: task.id, memberId: a.id, today: TODAY });
    const [mine] = await lines(a, 'Taken by mistake');
    expect((await giveBack(db, { assignmentId: mine.assignmentId!, memberId: b.id })).ok).toBe(false);
    expect((await lines(a, 'Taken by mistake'))[0].group).toBe('yours');
    expect((await giveBack(db, { assignmentId: mine.assignmentId!, memberId: a.id })).ok).toBe(true);
    expect((await lines(b, 'Taken by mistake'))[0].group).toBe('pool');
  });

  it('finished work on a closed task is marked as not reopenable, and reopening it does nothing', async () => {
    const db = getDb();
    const task = await published({ title: 'Closed after done', audience: 'person', memberIds: [a.id] });
    const [mine] = await lines(a, 'Closed after done');
    await markDone(db, { taskId: task.id, assignmentId: mine.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    await closeTask(db, task.id, lead.id);
    const row = (await finished(db, { limit: 100 })).find((f) => f.title === 'Closed after done');
    expect(row?.canReopen).toBe(false);
    await reopen(db, row!.assignmentId, lead.id);
    expect(await lines(a, 'Closed after done')).toHaveLength(0);
    const open = (await finished(db, { limit: 100 })).find((f) => f.title === 'Already done');
    expect(open?.canReopen).toBe(true);
  });
});
