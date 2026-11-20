// A member sends work in with a note and a link, and sees where it stands.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, submissions, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam, setActive } from '@/lib/members';
import { standingFor, submitWork } from '@/lib/submit';
import { claim, createTask, openFor, publishTask, settleReview, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';

describe('submitting work', () => {
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

  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };
  const line = async (member: Member, title: string) => (await openFor(getDb(), member.id, TODAY)).find((h) => h.title === title);
  const rowsFor = (assignmentId: string) => getDb().select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
  const stateOf = async (assignmentId: string) =>
    (await getDb().select().from(assignments).where(eq(assignments.id, assignmentId)))[0].state;
  const send = (member: Member, taskId: string, assignmentId: string | undefined, over: { note?: string; link?: string; via?: 'kiosk' | 'member_page' } = {}) =>
    submitWork(getDb(), { taskId, assignmentId, memberId: member.id, note: over.note ?? '', link: over.link ?? '', via: over.via ?? 'member_page', today: TODAY });
  /** A task for one person, and the id of their hand-out. */
  const mine = async (member: Member, title: string, extra: Partial<TaskInput> = {}) => {
    const task = await published({ title, audience: 'person', memberIds: [member.id], ...extra });
    return { task, assignmentId: (await line(member, title))!.assignmentId! };
  };

  it('a task that needs a check becomes "submitted" with one row holding the trimmed note, the link and how it was sent', async () => {
    const { task, assignmentId } = await mine(a, 'Needs a check');
    const result = await send(a, task.id, assignmentId, { note: '  Cut the plates.  \n', link: 'https://example.org/plates', via: 'member_page' });
    expect(result).toEqual({ ok: true, state: 'submitted' });
    expect(await stateOf(assignmentId)).toBe('submitted');
    const rows = await rowsFor(assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ memberId: a.id, note: 'Cut the plates.', link: 'https://example.org/plates', via: 'member_page', decision: null });
    expect(await line(a, 'Needs a check')).toBeUndefined();
  });

  it('records the kiosk as the way it was sent, and an empty note and link are fine', async () => {
    const { task, assignmentId } = await mine(a, 'From the kiosk');
    expect(await send(a, task.id, assignmentId, { via: 'kiosk' })).toEqual({ ok: true, state: 'submitted' });
    expect((await rowsFor(assignmentId))[0]).toMatchObject({ note: '', link: '', via: 'kiosk' });
  });

  it('a task with the check off becomes "done" and gets no row', async () => {
    const { task, assignmentId } = await mine(a, 'No check', { needsCheck: false });
    const result = await send(a, task.id, assignmentId, { note: 'Done it', link: 'https://example.org/x' });
    expect(result).toEqual({ ok: true, state: 'done' });
    expect(await stateOf(assignmentId)).toBe('done');
    expect(await rowsFor(assignmentId)).toHaveLength(0);
  });

  it('a note of 500 characters is kept; 501 is refused and nothing is written', async () => {
    const ok = await mine(a, 'Note at the limit');
    expect(await send(a, ok.task.id, ok.assignmentId, { note: 'n'.repeat(500) })).toMatchObject({ ok: true });
    const long = await mine(a, 'Note too long');
    const refused = await send(a, long.task.id, long.assignmentId, { note: 'n'.repeat(501) });
    expect(refused.ok).toBe(false);
    expect(await rowsFor(long.assignmentId)).toHaveLength(0);
    expect(await stateOf(long.assignmentId)).toBe('open');
    expect(await line(a, 'Note too long')).toBeDefined();
    // 10,000 characters is the same refusal, not a crash.
    expect((await send(a, long.task.id, long.assignmentId, { note: 'x'.repeat(10_000) })).ok).toBe(false);
    // Spaces around a note do not count toward the limit.
    const padded = await mine(a, 'Padded note');
    expect(await send(a, padded.task.id, padded.assignmentId, { note: `   ${'p'.repeat(500)}   ` })).toMatchObject({ ok: true });
  });

  let badLinkCount = 0;
  it.each([
    ['http://example.org/a'],
    ['javascript:alert(1)'],
    ['example.org'],
    ['https:/example.org'],
    ['ftp://example.org'],
    ['https://example.org/a b'],
    ['https://example.org/\nmore'],
    ['https://' + 'a'.repeat(293)],
  ])('the link %j is refused and nothing is written', async (link) => {
    const { task, assignmentId } = await mine(a, `Bad link ${badLinkCount++}`);
    const result = await send(a, task.id, assignmentId, { link });
    expect(result.ok).toBe(false);
    expect(await rowsFor(assignmentId)).toHaveLength(0);
    expect(await stateOf(assignmentId)).toBe('open');
  });

  it('a link of exactly 300 characters is kept, and the spaces around a link are trimmed', async () => {
    const full = 'https://' + 'a'.repeat(292);
    expect(full).toHaveLength(300);
    const one = await mine(a, 'Link at the limit');
    expect(await send(a, one.task.id, one.assignmentId, { link: full })).toMatchObject({ ok: true });
    const two = await mine(a, 'Link with spaces');
    expect(await send(a, two.task.id, two.assignmentId, { link: '  https://example.org/ok  ' })).toMatchObject({ ok: true });
    expect((await rowsFor(two.assignmentId))[0].link).toBe('https://example.org/ok');
  });

  it('a note with HTML in it is stored as the text it is, and a NUL character does not break the save', async () => {
    const { task, assignmentId } = await mine(a, 'Html note');
    const result = await send(a, task.id, assignmentId, { note: '<img src=x onerror=alert(1)> done\u0000' });
    expect(result.ok).toBe(true);
    expect((await rowsFor(assignmentId))[0].note).toBe('<img src=x onerror=alert(1)> done');
  });

  it('someone the hand-out is not for gets ok:false and no row', async () => {
    const { task, assignmentId } = await mine(a, 'Only for A');
    const result = await send(b, task.id, assignmentId, { note: 'mine now' });
    expect(result.ok).toBe(false);
    expect(await rowsFor(assignmentId)).toHaveLength(0);
    expect(await stateOf(assignmentId)).toBe('open');
  });

  it('a member who was deactivated a moment ago cannot send work in', async () => {
    const gone = await addMember(getDb(), { firstName: 'Test', lastName: 'Member Gone' }, null);
    const { task, assignmentId } = await mine(gone, 'For someone who left');
    await setActive(getDb(), gone.id, false, null);
    expect((await send(gone, task.id, assignmentId)).ok).toBe(false);
    expect(await rowsFor(assignmentId)).toHaveLength(0);
  });

  it('a hand-out id from another task is refused', async () => {
    const one = await mine(a, 'Task one of two');
    const two = await mine(a, 'Task two of two');
    expect((await send(a, one.task.id, two.assignmentId)).ok).toBe(false);
    expect(await rowsFor(two.assignmentId)).toHaveLength(0);
  });

  it('a standing task can be finished with no hand-out id, and its row hangs off the new hand-out', async () => {
    const chore = await published({ title: 'Sweep the floor', audience: 'pool', standing: true, needsCheck: true });
    const result = await send(a, chore.id, undefined, { note: 'Swept', link: '' });
    expect(result).toEqual({ ok: true, state: 'submitted' });
    const [made] = await getDb().select().from(assignments).where(eq(assignments.taskId, chore.id));
    expect(made).toMatchObject({ memberId: a.id, state: 'submitted', day: TODAY });
    expect((await rowsFor(made.id))[0].note).toBe('Swept');
  });

  it('a task that is not a standing one cannot be sent in without a hand-out id', async () => {
    const pool = await published({ title: 'Plain pool job', audience: 'pool' });
    const result = await send(a, pool.id, undefined, { note: 'pool-no-id' });
    expect(result.ok).toBe(false);
    const after = await getDb().select().from(assignments).where(eq(assignments.taskId, pool.id));
    expect(after.filter((r) => r.state === 'submitted' || r.state === 'done')).toHaveLength(0);
    expect(await getDb().select().from(submissions).where(eq(submissions.memberId, a.id)).then((r) => r.filter((x) => x.note === 'pool-no-id'))).toHaveLength(0);
  });

  it('work that was sent back and is sent in again gets a second row', async () => {
    const { task, assignmentId } = await mine(a, 'Redo me');
    await send(a, task.id, assignmentId, { note: 'first try' });
    expect((await getDb().transaction((tx) => settleReview(tx, { assignmentId, decision: 'sent_back' }))).ok).toBe(true);
    expect((await line(a, 'Redo me'))?.state).toBe('sent_back');
    expect(await send(a, task.id, assignmentId, { note: 'second try' })).toEqual({ ok: true, state: 'submitted' });
    const rows = await rowsFor(assignmentId);
    expect(rows.map((r) => r.note).sort()).toEqual(['first try', 'second try']);
  });

  it('ten submitWork calls at once on one hand-out give one row and one ok', async () => {
    const { task, assignmentId } = await mine(a, 'Pressed ten times');
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(a, task.id, assignmentId, { note: `press ${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await rowsFor(assignmentId)).toHaveLength(1);
  });

  it('a pool task taken by someone else cannot be sent in by a different member', async () => {
    const pool = await published({ title: 'Pool for one', audience: 'pool' });
    await claim(getDb(), { taskId: pool.id, memberId: a.id, today: TODAY });
    const mineLine = await line(a, 'Pool for one');
    expect((await send(b, pool.id, mineLine!.assignmentId)).ok).toBe(false);
    expect((await rowsFor(mineLine!.assignmentId!)).length).toBe(0);
    expect((await send(a, pool.id, mineLine!.assignmentId)).ok).toBe(true);
  });
});

describe('where each submission stands', () => {
  const getDb = useTestDb();
  let lead: Member;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    const db = getDb();
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
  });

  const sendIn = async (member: Member, title: string, note: string) => {
    const task = await createTask(getDb(), { title, audience: 'person', memberIds: [member.id] }, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    const assignmentId = (await openFor(getDb(), member.id, TODAY)).find((h) => h.title === title)!.assignmentId!;
    const result = await submitWork(getDb(), { taskId: task.id, assignmentId, memberId: member.id, note, link: 'https://example.org/' + title.length, via: 'member_page', today: TODAY });
    expect(result.ok).toBe(true);
    return { task, assignmentId };
  };

  it('shows waiting, approved and sent back, newest first, with the lead\'s comment', async () => {
    const first = await sendIn(a, 'Standing one', 'note one');
    const second = await sendIn(a, 'Standing two', 'note two');
    const third = await sendIn(a, 'Standing three', 'note three');
    // Approved: through settleReview, with the answer written on the row the way the review code does.
    await getDb().transaction(async (tx) => {
      await settleReview(tx, { assignmentId: first.assignmentId, decision: 'approved' });
      await tx.update(submissions).set({ decision: 'approved', comment: 'Nice work', reviewedById: lead.id, reviewedAt: new Date() }).where(eq(submissions.assignmentId, first.assignmentId));
    });
    // Sent back: also through settleReview, so the hand-out and its row agree, as they always do in the app.
    await getDb().transaction(async (tx) => {
      await settleReview(tx, { assignmentId: second.assignmentId, decision: 'sent_back' });
      await tx.update(submissions).set({ decision: 'sent_back', comment: 'Add the photo', reviewedById: lead.id, reviewedAt: new Date() }).where(eq(submissions.assignmentId, second.assignmentId));
    });
    // Third is still waiting.

    const rows = await standingFor(getDb(), a.id);
    expect(rows.map((r) => r.title)).toEqual(['Standing three', 'Standing two', 'Standing one']);
    expect(rows.map((r) => r.state)).toEqual(['waiting', 'sent_back', 'approved']);
    expect(rows[0]).toMatchObject({ assignmentId: third.assignmentId, note: 'note three', comment: '' });
    expect(rows[1]).toMatchObject({ comment: 'Add the photo', note: 'note two' });
    expect(rows[2]).toMatchObject({ comment: 'Nice work', link: 'https://example.org/' + 'Standing one'.length });
    expect(rows[0].at).toBeInstanceOf(Date);
  });

  it('shows only that member\'s own work', async () => {
    await sendIn(b, 'Only B has this', 'b note');
    expect((await standingFor(getDb(), a.id)).map((r) => r.title)).not.toContain('Only B has this');
    expect((await standingFor(getDb(), b.id)).map((r) => r.title)).toEqual(['Only B has this']);
  });

  it('shows at most 20, newest first', async () => {
    const c = await addMember(getDb(), { firstName: 'Test', lastName: 'Member C' }, null);
    for (let i = 1; i <= 22; i++) await sendIn(c, `Many ${String(i).padStart(2, '0')}`, '');
    const rows = await standingFor(getDb(), c.id);
    expect(rows).toHaveLength(20);
    expect(rows[0].title).toBe('Many 22');
    expect(rows[19].title).toBe('Many 03');
  });

  it('a task the lead closed while it waited is not shown as waiting', async () => {
    const d = await addMember(getDb(), { firstName: 'Test', lastName: 'Member D' }, null);
    const { assignmentId } = await sendIn(d, 'Closed while waiting', 'x');
    await getDb().update(assignments).set({ state: 'closed', closedAt: new Date() }).where(eq(assignments.id, assignmentId));
    expect(await standingFor(getDb(), d.id)).toEqual([]);
  });
});
