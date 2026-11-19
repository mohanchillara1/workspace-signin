import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@/lib/day';
import { changeLog, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam, setActive } from '@/lib/members';
import {
  claim,
  closeTask,
  createTask,
  finished,
  markDone,
  membersWithNothing,
  openFor,
  publishTask,
  release,
  reopen,
  setStepsDone,
} from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-18';

describe('tasks and hand-outs', () => {
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
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamId: build.id }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamId: build.id }, null);
    c = await addMember(db, { firstName: 'Test', lastName: 'Member C', subteamId: code.id }, null);
  });

  const titles = async (member: Member, day = TODAY) => (await openFor(getDb(), member.id, day)).map((h) => h.title);
  const find = async (member: Member, title: string, day = TODAY) =>
    (await openFor(getDb(), member.id, day)).find((h) => h.title === title);
  const published = async (input: Parameters<typeof createTask>[1]) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };

  it('keeps a draft and a closed task out of every list', async () => {
    const db = getDb();
    const draft = await createTask(db, { title: 'Draft only', audience: 'person', memberIds: [a.id] }, lead.id);
    expect(await titles(a)).not.toContain('Draft only');
    await publishTask(db, draft.id, lead.id);
    expect(await titles(a)).toContain('Draft only');
    await closeTask(db, draft.id, lead.id);
    expect(await titles(a)).not.toContain('Draft only');
  });

  it('person task, everyone does their own: one finishing leaves the other with it', async () => {
    const task = await published({ title: 'Each of two', audience: 'person', memberIds: [a.id, b.id], completion: 'each' });
    const mine = await find(a, 'Each of two');
    expect(mine?.group).toBe('yours');
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY })).ok).toBe(true);
    expect(await titles(a)).not.toContain('Each of two');
    expect(await titles(b)).toContain('Each of two');
  });

  it('person task, done once for the group: one finishing clears it for both', async () => {
    const task = await published({ title: 'Once for two', audience: 'person', memberIds: [a.id, b.id] });
    const mine = await find(b, 'Once for two');
    await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: b.id, via: 'member_page', today: TODAY });
    expect(await titles(a)).not.toContain('Once for two');
    expect(await titles(b)).not.toContain('Once for two');
    const done = (await finished(getDb(), { limit: 50 })).filter((f) => f.title === 'Once for two');
    expect(done).toHaveLength(1);
    expect(done[0].doneBy).toBe('Test M.');
    expect(done[0].doneByFull).toBe('Test Member B');
    expect(done[0].doneVia).toBe('member_page');
  });

  it('subteam task, done once: the whole subteam sees it, nobody else, and one finish clears it', async () => {
    const task = await published({ title: 'Build once', audience: 'subteam', subteamId: build.id });
    expect((await find(a, 'Build once'))?.group).toBe('subteam');
    expect(await titles(b)).toContain('Build once');
    expect(await titles(c)).not.toContain('Build once');
    const mine = await find(a, 'Build once');
    // Someone outside the subteam cannot finish it.
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: c.id, via: 'kiosk', today: TODAY })).ok).toBe(false);
    expect(await titles(a)).toContain('Build once');
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY })).ok).toBe(true);
    expect(await titles(b)).not.toContain('Build once');
  });

  it('subteam task, everyone does their own: each member has their own', async () => {
    const task = await published({ title: 'Build each', audience: 'subteam', subteamId: build.id, completion: 'each' });
    const mine = await find(a, 'Build each');
    expect(mine?.group).toBe('subteam');
    await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    expect(await titles(a)).not.toContain('Build each');
    expect(await titles(b)).toContain('Build each');
    expect(await titles(c)).not.toContain('Build each');
  });

  it('pool task: one claimer at a time, and a lead can take it back', async () => {
    const task = await published({ title: 'Pool job', audience: 'pool' });
    expect((await find(a, 'Pool job'))?.group).toBe('pool');
    expect((await find(c, 'Pool job'))?.group).toBe('pool');
    const results = await Promise.all([
      claim(getDb(), { taskId: task.id, memberId: a.id, today: TODAY }),
      claim(getDb(), { taskId: task.id, memberId: c.id, today: TODAY }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results[0].ok ? a : c;
    const loser = results[0].ok ? c : a;
    const claimed = await find(winner, 'Pool job');
    expect(claimed?.group).toBe('yours');
    expect(claimed?.state).toBe('claimed');
    expect(await titles(loser)).not.toContain('Pool job');
    await release(getDb(), claimed!.assignmentId!, lead.id);
    expect((await find(loser, 'Pool job'))?.group).toBe('pool');
    expect((await find(winner, 'Pool job'))?.group).toBe('pool');
  });

  it('standing task: done today hides it today, and it is back tomorrow', async () => {
    const task = await published({ title: 'Sweep the floor', audience: 'pool', standing: true });
    expect(task.needsCheck).toBe(false);
    expect((await find(a, 'Sweep the floor'))?.standing).toBe(true);
    expect((await claim(getDb(), { taskId: task.id, memberId: a.id, today: TODAY })).ok).toBe(true);
    expect((await claim(getDb(), { taskId: task.id, memberId: b.id, today: TODAY })).ok).toBe(false);
    expect(await titles(b)).not.toContain('Sweep the floor');
    const mine = await find(a, 'Sweep the floor');
    expect(mine?.group).toBe('yours');
    await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    expect(await titles(a)).not.toContain('Sweep the floor');
    expect(await titles(c)).not.toContain('Sweep the floor');
    const tomorrow = addDays(TODAY, 1);
    expect(await titles(c, tomorrow)).toContain('Sweep the floor');
    // Finished without claiming first, on the next day.
    expect((await markDone(getDb(), { taskId: task.id, memberId: c.id, via: 'kiosk', today: tomorrow })).ok).toBe(true);
    const done = (await finished(getDb(), { limit: 50 })).filter((f) => f.title === 'Sweep the floor');
    expect(done).toHaveLength(2);
  });

  it('marks a task past its due day as overdue and sorts the soonest first', async () => {
    await published({ title: 'Due later', audience: 'person', memberIds: [c.id], dueDay: '2026-11-25' });
    await published({ title: 'Due before', audience: 'person', memberIds: [c.id], dueDay: '2026-11-10' });
    await published({ title: 'No due day', audience: 'person', memberIds: [c.id] });
    const list = (await openFor(getDb(), c.id, TODAY)).filter((h) => h.group === 'yours');
    expect(list.map((h) => h.title)).toEqual(['Due before', 'Due later', 'No due day']);
    expect(list[0].overdue).toBe(true);
    expect(list[1].overdue).toBe(false);
  });

  it('puts your own first, then your subteam, then the pool', async () => {
    await published({ title: 'Code once', audience: 'subteam', subteamId: code.id });
    await published({ title: 'Another pool job', audience: 'pool' });
    const groups = (await openFor(getDb(), c.id, TODAY)).map((h) => h.group);
    const order = { yours: 0, subteam: 1, pool: 2 };
    expect([...groups].sort((x, y) => order[x] - order[y])).toEqual(groups);
    expect(new Set(groups)).toEqual(new Set(['yours', 'subteam', 'pool']));
  });

  it('keeps ticked steps, and only for the person the hand-out is for', async () => {
    const task = await published({ title: 'With steps', audience: 'person', memberIds: [a.id], steps: ['One', ' ', 'Two', 'Three'] });
    const mine = await find(a, 'With steps');
    expect(mine?.steps).toEqual(['One', 'Two', 'Three']);
    expect((await setStepsDone(getDb(), { assignmentId: mine!.assignmentId!, memberId: b.id, stepsDone: [0] })).ok).toBe(false);
    expect((await setStepsDone(getDb(), { assignmentId: mine!.assignmentId!, memberId: a.id, stepsDone: [2, 0, 9] })).ok).toBe(true);
    expect((await find(a, 'With steps'))?.stepsDone).toEqual([0, 2]);
    expect(task.steps).toEqual(['One', 'Two', 'Three']);
  });

  it('lists finished work with who and when, and reopening puts it back and logs the lead', async () => {
    const db = getDb();
    const task = await published({ title: 'Finish then reopen', audience: 'person', memberIds: [a.id] });
    const mine = await find(a, 'Finish then reopen');
    await markDone(db, { taskId: task.id, assignmentId: mine!.assignmentId, memberId: a.id, via: 'kiosk', today: TODAY });
    const row = (await finished(db, { limit: 50 })).find((f) => f.title === 'Finish then reopen');
    expect(row?.doneBy).toBe('Test M.');
    expect(row?.doneAt).toBeInstanceOf(Date);
    expect(row?.needsCheck).toBe(true);
    await reopen(db, row!.assignmentId, lead.id);
    expect(await titles(a)).toContain('Finish then reopen');
    const logged = await db.select().from(changeLog).where(eq(changeLog.action, 'assignment.reopen'));
    expect(logged.some((l) => l.actorId === lead.id && l.entityId === row!.assignmentId)).toBe(true);
  });

  it('refuses a finish from someone the hand-out is not for', async () => {
    const task = await published({ title: 'Only for A', audience: 'person', memberIds: [a.id] });
    const mine = await find(a, 'Only for A');
    const result = await markDone(getDb(), { taskId: task.id, assignmentId: mine!.assignmentId, memberId: c.id, via: 'kiosk', today: TODAY });
    expect(result.ok).toBe(false);
    expect(await titles(a)).toContain('Only for A');
  });

  it('lists active members who have no open task of their own or their subteam', async () => {
    const db = getDb();
    const idle = await addMember(db, { firstName: 'Idle', lastName: 'Person' }, null);
    const gone = await addMember(db, { firstName: 'Gone', lastName: 'Person' }, null);
    await setActive(db, gone.id, false, null);
    const nothing = await membersWithNothing(db, TODAY);
    expect(nothing.map((m) => m.memberId)).toContain(idle.id);
    expect(nothing.map((m) => m.memberId)).not.toContain(gone.id);
    expect(nothing.map((m) => m.memberId)).not.toContain(c.id);
    // A pool task does not count as "has a task": idle still has none of their own.
    const forIdle = await openFor(db, idle.id, TODAY);
    expect(forIdle.length).toBeGreaterThan(0);
    expect(forIdle.every((h) => h.group === 'pool')).toBe(true);
  });

  it('refuses a task with no title, no people, or no subteam', async () => {
    const db = getDb();
    await expect(createTask(db, { title: ' ', audience: 'pool' }, lead.id)).rejects.toThrow();
    await expect(createTask(db, { title: 'x', audience: 'person', memberIds: [] }, lead.id)).rejects.toThrow();
    await expect(createTask(db, { title: 'x', audience: 'subteam' }, lead.id)).rejects.toThrow();
  });
});
