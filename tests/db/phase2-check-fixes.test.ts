// Faults the check of the merged phase 2 found, each as a test.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam, setActive } from '@/lib/members';
import { decide, reviewQueue } from '@/lib/review';
import { handleScan } from '@/lib/scan';
import { linkProblem, standingFor, submitWork } from '@/lib/submit';
import { claim, closeTask, createTask, giveBack, openFor, publishTask, release, reopen, updateTask, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const DAY1 = '2026-11-19';
const DAY2 = '2026-11-20';

describe('phase 2 check fixes', () => {
  const getDb = useTestDb();
  let lead: Member;
  let lead2: Member;
  let a: Member;
  let b: Member;
  let c: Member;
  let build: Subteam;

  beforeAll(async () => {
    const db = getDb();
    build = await addSubteam(db, 'Build');
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    lead2 = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamIds: [build.id] }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamIds: [build.id] }, null);
    c = await addMember(db, { firstName: 'Test', lastName: 'Member C' }, null);
  });

  const line = async (member: Member, title: string, day = DAY1) => (await openFor(getDb(), member.id, day)).find((h) => h.title === title);
  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };
  const send = async (member: Member, title: string, note = 'did it', day = DAY1) => {
    const h = await line(member, title, day);
    return submitWork(getDb(), { taskId: h!.taskId, assignmentId: h!.assignmentId, memberId: member.id, note, link: '', via: 'member_page', today: day });
  };
  const queued = async (title: string) => (await reviewQueue(getDb())).filter((r) => r.title === title);
  const answer = async (title: string, decision: 'approved' | 'sent_back', comment = '', actor = lead) => {
    const [row] = await queued(title);
    return decide(getDb(), { assignmentId: row.assignmentId, decision, comment, actorId: actor.id });
  };
  const sentIn = async (member: Member, title: string) => (await standingFor(getDb(), member.id)).filter((s) => s.title === title);

  it('closing a task takes its waiting work out of the queue and off the member\'s sent-in list', async () => {
    const db = getDb();
    const task = await published({ title: 'Closed while waiting', audience: 'person', memberIds: [a.id] });
    await send(a, 'Closed while waiting');
    const [row] = await queued('Closed while waiting');
    await closeTask(db, task.id, lead.id);
    expect(await queued('Closed while waiting')).toHaveLength(0);
    expect(await sentIn(a, 'Closed while waiting')).toHaveLength(0);
    expect((await decide(db, { assignmentId: row.assignmentId, decision: 'approved', comment: '', actorId: lead.id })).ok).toBe(false);
  });

  it('"done once" work that was sent back is not handed to the others by an edit', async () => {
    const db = getDb();
    const input: TaskInput = { title: 'Once then sent back', audience: 'person', memberIds: [a.id, b.id, c.id] };
    const task = await published(input);
    await send(a, 'Once then sent back');
    await answer('Once then sent back', 'sent_back', 'Redo the left side');
    await updateTask(db, task.id, { ...input, description: 'a lead fixed a typo' }, lead.id);
    expect((await line(a, 'Once then sent back'))?.state).toBe('sent_back');
    expect(await line(b, 'Once then sent back')).toBeUndefined();
    expect(await line(c, 'Once then sent back')).toBeUndefined();
  });

  it('a pool task that was sent back can be put back by the member, taken back by a lead, and is freed when its holder is deactivated', async () => {
    const db = getDb();
    const holder = await addMember(db, { firstName: 'Pool', lastName: 'Holder' }, null);
    for (const how of ['member', 'lead', 'deactivate'] as const) {
      const title = `Sent back pool ${how}`;
      const task = await published({ title, audience: 'pool' });
      await claim(db, { taskId: task.id, memberId: holder.id, today: DAY1 });
      await send(holder, title);
      await answer(title, 'sent_back', 'Not finished');
      const mine = await line(holder, title);
      expect(mine).toMatchObject({ state: 'sent_back', group: 'yours', canGiveBack: true });
      if (how === 'member') expect((await giveBack(db, { assignmentId: mine!.assignmentId!, memberId: holder.id })).ok).toBe(true);
      if (how === 'lead') await release(db, mine!.assignmentId!, lead.id);
      if (how === 'deactivate') await setActive(db, holder.id, false, lead.id);
      expect((await line(b, title))?.group).toBe('pool');
      if (how === 'deactivate') await setActive(db, holder.id, true, lead.id);
    }
  });

  it('a standing task sent back shows on the member\'s list the next day too, beside the new day\'s copy', async () => {
    const db = getDb();
    const task = await published({ title: 'Standing with a check', audience: 'pool', standing: true, needsCheck: true });
    const first = await submitWork(db, { taskId: task.id, memberId: a.id, note: 'swept', link: '', via: 'kiosk', today: DAY1 });
    expect(first.state).toBe('submitted');
    await answer('Standing with a check', 'sent_back', 'The corner was missed');
    const tomorrow = (await openFor(db, a.id, DAY2)).filter((h) => h.title === 'Standing with a check');
    expect(tomorrow.map((h) => h.state).sort()).toEqual(['open', 'sent_back']);
    const back = tomorrow.find((h) => h.state === 'sent_back')!;
    expect(back).toMatchObject({ group: 'yours', sentBackComment: 'The corner was missed' });
    // Nobody else sees the sent-back one; they see only the new day's.
    expect((await openFor(db, b.id, DAY2)).filter((h) => h.title === 'Standing with a check').map((h) => h.state)).toEqual(['open']);
    const again = await submitWork(db, { taskId: task.id, assignmentId: back.assignmentId, memberId: a.id, note: 'did the corner', link: '', via: 'member_page', today: DAY2 });
    expect(again).toMatchObject({ ok: true, state: 'submitted' });
  });

  it('changing who a task is for while work on it waits does not hand out a second copy', async () => {
    const db = getDb();
    const task = await published({ title: 'Reshaped while waiting', audience: 'person', memberIds: [a.id] });
    await send(a, 'Reshaped while waiting');
    await updateTask(db, task.id, { title: 'Reshaped while waiting', audience: 'pool' }, lead.id);
    expect(await line(a, 'Reshaped while waiting')).toBeUndefined();
    expect(await line(b, 'Reshaped while waiting')).toBeUndefined();
    expect(await queued('Reshaped while waiting')).toHaveLength(1);
    await answer('Reshaped while waiting', 'sent_back', 'Try again');
    expect((await line(a, 'Reshaped while waiting'))?.state).toBe('sent_back');
    expect(await line(b, 'Reshaped while waiting')).toBeUndefined();
  });

  it('a lead cannot answer their own work; another lead can', async () => {
    const db = getDb();
    await published({ title: 'A lead\'s own job', audience: 'person', memberIds: [lead.id] });
    await send(lead, 'A lead\'s own job');
    expect(await answer('A lead\'s own job', 'approved', '', lead)).toEqual({ ok: false, reason: 'own_work' });
    expect(await answer('A lead\'s own job', 'sent_back', 'no', lead)).toEqual({ ok: false, reason: 'own_work' });
    expect(await queued('A lead\'s own job')).toHaveLength(1);
    expect((await answer('A lead\'s own job', 'approved', '', lead2)).ok).toBe(true);
    void db;
  });

  it('a comment with a NUL character is cleaned, not a crash', async () => {
    await published({ title: 'Odd comment', audience: 'person', memberIds: [b.id] });
    await send(b, 'Odd comment');
    expect((await answer('Odd comment', 'sent_back', 'bad\u0000 byte')).ok).toBe(true);
    expect((await line(b, 'Odd comment'))?.sentBackComment).toBe('bad byte');
  });

  it('the sent-in list shows each piece of work once, as it stands now', async () => {
    const db = getDb();
    await published({ title: 'Three rounds', audience: 'person', memberIds: [c.id] });
    await send(c, 'Three rounds', 'first try');
    expect((await sentIn(c, 'Three rounds')).map((s) => s.state)).toEqual(['waiting']);
    await answer('Three rounds', 'sent_back', 'Closer');
    expect(await sentIn(c, 'Three rounds')).toMatchObject([{ state: 'sent_back', comment: 'Closer' }]);
    await send(c, 'Three rounds', 'second try');
    expect(await sentIn(c, 'Three rounds')).toMatchObject([{ state: 'waiting', note: 'second try' }]);
    const [waiting] = await queued('Three rounds');
    // The lead sees it is a second try and what was said the first time.
    expect(waiting).toMatchObject({ round: 2, lastComment: 'Closer', note: 'second try' });
    await answer('Three rounds', 'approved');
    expect((await sentIn(c, 'Three rounds')).map((s) => s.state)).toEqual(['approved']);
    // Reopened by a lead: it is plain work again, and the old "approved" is gone from the list.
    await reopen(db, waiting.assignmentId, lead.id);
    expect((await line(c, 'Three rounds'))?.state).toBe('open');
    expect(await sentIn(c, 'Three rounds')).toHaveLength(0);
  });

  it('reopening "done once" work puts it back with whoever finished it, also after a send-back round', async () => {
    const db = getDb();
    const task = await published({ title: 'Once, two rounds, reopened', audience: 'person', memberIds: [a.id, b.id] });
    await send(a, 'Once, two rounds, reopened');
    await answer('Once, two rounds, reopened', 'sent_back', 'again');
    await send(a, 'Once, two rounds, reopened');
    const [row] = await queued('Once, two rounds, reopened');
    await answer('Once, two rounds, reopened', 'approved');
    await reopen(db, row.assignmentId, lead.id);
    expect((await line(a, 'Once, two rounds, reopened'))?.state).toBe('open');
    expect(await line(b, 'Once, two rounds, reopened')).toBeUndefined();
    const states = (await db.select().from(assignments).where(eq(assignments.taskId, task.id))).map((r) => r.state).sort();
    expect(states).toEqual(['closed', 'open']);
  });

  it('the kiosk is never given the lead\'s comment', async () => {
    const db = getDb();
    await published({ title: 'Comment stays off the wall', audience: 'person', memberIds: [b.id] });
    await send(b, 'Comment stays off the wall');
    await answer('Comment stays off the wall', 'sent_back', 'Private words about the work');
    const scan = await handleScan(db, { code: b.scanCode, kioskId: null, now: new Date('2026-11-19T22:00:00Z') });
    expect(scan.status).toBe('ok');
    if (scan.status !== 'ok') return;
    const onWall = scan.tasks!.find((t) => t.title === 'Comment stays off the wall');
    expect(onWall).toMatchObject({ state: 'sent_back', sentBackComment: null });
    expect(JSON.stringify(scan)).not.toContain('Private words');
    // Their own page still has it.
    expect((await line(b, 'Comment stays off the wall'))?.sentBackComment).toBe('Private words about the work');
  });

  it('a link may only hold plain visible characters', () => {
    expect(linkProblem('https://example.org/a-b_c?d=1&e=%20#f')).toBeNull();
    expect(linkProblem('https://good.example‮/moc.live.example')).toBe('link_bad');
    expect(linkProblem('https://exa​mple.org/x')).toBe('link_bad');
    expect(linkProblem('https://exаmple.org/')).toBe('link_bad');
  });
});
