// /done in Slack, and the Slack id a lead records for a member.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { copy } from '@/lib/copy';
import { assignments, changeLog, members, submissions, type Member } from '@/lib/db/schema';
import { addMember, addSubteam, memberBySlackUserId, setActive, setSlackUserId } from '@/lib/members';
import { answerSlackCommand, handleCommand } from '@/lib/slack';
import { createTask, openFor, publishTask, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';
const NOW = new Date('2026-11-19T18:00:00Z');
const A = 'U0AAAAAAA1';
const B = 'U0BBBBBBB2';

describe('/done', () => {
  const getDb = useTestDb();
  let lead: Member;
  let captain: Member;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    const db = getDb();
    const build = await addSubteam(db, 'Build');
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamId: build.id }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamId: build.id }, null);
    expect(await setSlackUserId(db, a.id, A, lead.id)).toEqual({ ok: true });
    expect(await setSlackUserId(db, b.id, B, lead.id)).toEqual({ ok: true });
  });

  const publish = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };
  const say = (text: string, slackUserId = A) => handleCommand(getDb(), { slackUserId, text, today: TODAY, now: NOW });
  const titles = async (member: Member) => (await openFor(getDb(), member.id, TODAY)).map((h) => h.title);
  const rowFor = async (taskId: string) => (await getDb().select().from(assignments).where(eq(assignments.taskId, taskId)))[0];

  it('says so and does nothing when the Slack account is not recorded for anyone', async () => {
    const before = await getDb().select().from(assignments);
    const out = await say('1', 'U0ZZZZZZZ9');
    expect(out.text).toBe(copy.slack.notLinked);
    expect(await getDb().select().from(assignments)).toEqual(before);
    expect((await say('', 'not an id')).text).toBe(copy.slack.notLinked);
  });

  it('says so for a member who is not active, and changes nothing', async () => {
    const db = getDb();
    const gone = await addMember(db, { firstName: 'Test', lastName: 'Member Gone' }, null);
    await setSlackUserId(db, gone.id, 'U0GONEGON3', lead.id);
    const task = await publish({ title: 'Gone task', audience: 'person', memberIds: [gone.id], needsCheck: false });
    await setActive(db, gone.id, false, lead.id);
    const out = await say('1', 'U0GONEGON3');
    expect(out.text).toBe(copy.slack.notLinked);
    expect((await rowFor(task.id)).state).not.toBe('done');
  });

  it('lists open tasks, numbered, in the order openFor gives them, titles only', async () => {
    const task1 = await publish({ title: 'First thing', audience: 'person', memberIds: [a.id], description: 'SECRET DESCRIPTION', steps: ['SECRET STEP'] });
    await publish({ title: 'Second thing', audience: 'person', memberIds: [a.id] });
    await publish({ title: 'For B only', audience: 'person', memberIds: [b.id] });
    const expected = await titles(a);
    const out = await say('');
    const lines = out.text.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toEqual(expected.map((t, i) => `${i + 1}. ${t}`));
    expect(out.text).toContain(copy.slack.listHelp);
    expect(out.text).not.toContain('SECRET');
    expect(out.text).not.toContain('For B only');
    expect(out.text).not.toContain('Member');
    expect((await rowFor(task1.id)).state).toBe('open');
  });

  it('escapes the three characters Slack treats as markup in a title', async () => {
    await publish({ title: 'Wire <@U0AAAAAAA1> & test > fit', audience: 'person', memberIds: [a.id] });
    const out = await say('');
    expect(out.text).toContain('Wire &lt;@U0AAAAAAA1&gt; &amp; test &gt; fit');
    expect(out.text).not.toContain('<@U0AAAAAAA1>');
  });

  it('answers a list that is empty in plain words', async () => {
    const c = await addMember(getDb(), { firstName: 'Test', lastName: 'Member Empty' }, null);
    await setSlackUserId(getDb(), c.id, 'U0EMPTYEM4', lead.id);
    expect((await say('', 'U0EMPTYEM4')).text).toBe(copy.slack.nothingOpen);
    expect((await say('1', 'U0EMPTYEM4')).text).toBe(copy.slack.badNumber(1, 0));
  });

  it('finishes a task that needs no check: the hand-out is done, via slack, and no submissions row is made', async () => {
    const task = await publish({ title: 'No check needed', audience: 'person', memberIds: [a.id], needsCheck: false });
    const list = await titles(a);
    const n = list.indexOf('No check needed') + 1;
    const out = await say(String(n));
    expect(out.text).toBe(copy.slack.finished('No check needed'));
    const row = await rowFor(task.id);
    expect(row.state).toBe('done');
    expect(row.doneVia).toBe('slack');
    expect(row.doneById).toBe(a.id);
    expect(await getDb().select().from(submissions).where(eq(submissions.assignmentId, row.id))).toHaveLength(0);
    expect(await titles(a)).not.toContain('No check needed');
  });

  it('sends a task that needs a check to the review queue, with the words as the note and no link', async () => {
    const task = await publish({ title: 'Needs a look', audience: 'person', memberIds: [a.id], needsCheck: true });
    const n = (await titles(a)).indexOf('Needs a look') + 1;
    const out = await say(`${n}   cut the plates   and sanded them `);
    expect(out.text).toBe(copy.slack.waiting('Needs a look'));
    const row = await rowFor(task.id);
    expect(row.state).toBe('submitted');
    expect(row.doneVia).toBe('slack');
    const subs = await getDb().select().from(submissions).where(eq(submissions.assignmentId, row.id));
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ via: 'slack', note: 'cut the plates   and sanded them', link: '', memberId: a.id, decision: null });
  });

  it('refuses a number that is not on the list, a zero, and words that are not a number, and changes nothing', async () => {
    const before = JSON.stringify(await getDb().select().from(assignments));
    const count = (await titles(a)).length;
    expect((await say(String(count + 1))).text).toBe(copy.slack.badNumber(count + 1, count));
    expect((await say('0')).text).toBe(copy.slack.badNumber(0, count));
    expect((await say('99999999999999999999')).text).toBe(copy.slack.usage);
    expect((await say('first')).text).toBe(copy.slack.usage);
    expect((await say('-1')).text).toBe(copy.slack.usage);
    expect(JSON.stringify(await getDb().select().from(assignments))).toBe(before);
  });

  it('refuses a note that is too long and leaves the task on the list', async () => {
    const task = await publish({ title: 'Long note', audience: 'person', memberIds: [a.id], needsCheck: true });
    const n = (await titles(a)).indexOf('Long note') + 1;
    const out = await say(`${n} ${'x'.repeat(5000)}`);
    expect(out.text).toBe(copy.slack.noteLong);
    expect((await rowFor(task.id)).state).toBe('open');
  });

  it('never carries a lead comment, a note or another member name', async () => {
    const task = await publish({ title: 'Back to you', audience: 'person', memberIds: [b.id], needsCheck: true });
    const n = (await titles(b)).indexOf('Back to you') + 1;
    await say(`${n} PRIVATE NOTE FROM B`, B);
    const row = await rowFor(task.id);
    await getDb().update(assignments).set({ state: 'sent_back' }).where(eq(assignments.id, row.id));
    await getDb().update(submissions).set({ decision: 'sent_back', comment: 'LEAD COMMENT', reviewedAt: new Date() }).where(eq(submissions.assignmentId, row.id));
    const listing = (await say('', B)).text;
    expect(listing).toContain('Back to you');
    for (const word of ['LEAD COMMENT', 'PRIVATE NOTE', 'Test', 'Member', 'Lead']) expect(listing).not.toContain(word);
  });

  it('a task for another member cannot be finished by number from this one', async () => {
    const before = await titles(b);
    await say('1');
    await say('2');
    expect(await titles(b)).toEqual(before);
  });

  it('limits each Slack user, and counts them separately', async () => {
    const send = (user: string) => answerSlackCommand(getDb(), { slackUserId: user, text: '', today: TODAY, now: NOW });
    const outs = [];
    for (let i = 0; i < 25; i++) outs.push((await send('U0RATELIM5')).text);
    expect(outs.filter((t) => t === copy.slack.tooMany).length).toBeGreaterThan(0);
    expect(outs[0]).not.toBe(copy.slack.tooMany);
    expect(outs.slice(0, 20).every((t) => t !== copy.slack.tooMany)).toBe(true);
    expect((await send('U0RATELIM6')).text).not.toBe(copy.slack.tooMany);
  });

  it('answers in plain words when something breaks after the signature check', async () => {
    const broken = { select: () => { throw new Error('database down'); } } as never;
    const out = await answerSlackCommand(broken, { slackUserId: A, text: '', today: TODAY, now: NOW });
    expect(out.text).toBe(copy.slack.failed);
  });
});

describe('recording a Slack member id', () => {
  const getDb = useTestDb();
  let captain: Member;
  let lead: Member;
  let other: Member;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    const db = getDb();
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    other = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
  });

  it('stores a good id, trims it, finds the member by it, and writes a change-log row', async () => {
    const db = getDb();
    expect(await setSlackUserId(db, a.id, '  U123ABC456 ', lead.id)).toEqual({ ok: true });
    expect((await memberBySlackUserId(db, 'U123ABC456'))?.id).toBe(a.id);
    const [row] = await db.select().from(changeLog).where(eq(changeLog.action, 'member.slack_id'));
    expect(row).toMatchObject({ actorId: lead.id, entity: 'member', entityId: a.id });
  });

  it('refuses a bad shape and stores nothing', async () => {
    const db = getDb();
    for (const bad of ['u123abc456', 'U12', '@mohan', '<@U123ABC456>', 'U123 ABC456', 'T1DC2JH3J', 'U'.repeat(50)]) {
      expect(await setSlackUserId(db, b.id, bad, lead.id)).toEqual({ ok: false, reason: 'shape' });
    }
    expect((await db.select().from(members).where(eq(members.id, b.id)))[0].slackUserId).toBeNull();
  });

  it('refuses an id another member already has, and lets the same member save it again', async () => {
    const db = getDb();
    expect(await setSlackUserId(db, b.id, 'U123ABC456', lead.id)).toEqual({ ok: false, reason: 'taken' });
    expect(await setSlackUserId(db, a.id, 'U123ABC456', lead.id)).toEqual({ ok: true });
  });

  it('clears the id with an empty value or null, and the member is no longer found by it', async () => {
    const db = getDb();
    expect(await setSlackUserId(db, a.id, '', lead.id)).toEqual({ ok: true });
    expect(await memberBySlackUserId(db, 'U123ABC456')).toBeNull();
    await setSlackUserId(db, a.id, 'U123ABC456', lead.id);
    expect(await setSlackUserId(db, a.id, null, lead.id)).toEqual({ ok: true });
    expect((await db.select().from(members).where(eq(members.id, a.id)))[0].slackUserId).toBeNull();
    // The id can now go to someone else.
    expect(await setSlackUserId(db, b.id, 'U123ABC456', lead.id)).toEqual({ ok: true });
    await setSlackUserId(db, b.id, null, lead.id);
  });

  it('does not find a deactivated member by Slack id', async () => {
    const db = getDb();
    await setSlackUserId(db, a.id, 'U123ABC456', lead.id);
    await setActive(db, a.id, false, lead.id);
    expect(await memberBySlackUserId(db, 'U123ABC456')).toBeNull();
    await setActive(db, a.id, true, lead.id);
    expect((await memberBySlackUserId(db, 'U123ABC456'))?.id).toBe(a.id);
    expect(await memberBySlackUserId(db, 'not an id')).toBeNull();
  });

  it('keeps the rule the other edits keep: a lead may not change a captain or another lead, a captain may, nobody else', async () => {
    const db = getDb();
    await expect(setSlackUserId(db, captain.id, 'U0CAPTAIN1', lead.id)).rejects.toThrow();
    await expect(setSlackUserId(db, other.id, 'U0OTHERLD2', lead.id)).rejects.toThrow();
    await expect(setSlackUserId(db, a.id, 'U0MEMBERX3', a.id)).rejects.toThrow();
    expect(await setSlackUserId(db, lead.id, 'U0LEADSELF', lead.id)).toEqual({ ok: true });
    expect(await setSlackUserId(db, other.id, 'U0OTHERLD2', captain.id)).toEqual({ ok: true });
    expect((await db.select().from(members).where(eq(members.id, captain.id)))[0].slackUserId).toBeNull();
  });
});
