// One person in several subteams, and subteams that sit under another one.
// The people here are made up.
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignments, memberSubteams, members, type Member, type Subteam } from '@/lib/db/schema';
import { UserError } from '@/lib/errors';
import { newPageKey, newScanCode } from '@/lib/ids';
import { addMember, addSubteam, importRoster, listMembers, listSubteams, removeSubteam, setActive, updateMember } from '@/lib/members';
import { createTask, markDone, membersWithNothing, openFor, publishTask, setStepsDone, type TaskInput } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const TODAY = '2026-11-19';

describe('several subteams for one person', () => {
  const getDb = useTestDb();
  let lead: Member;
  let mech: Subteam;
  let assembly: Subteam;
  let cad: Subteam;
  let business: Subteam;
  let media: Subteam;
  let code: Subteam;
  // a: Assembly and CAD (both under Mech). b: CAD and Media (two top subteams).
  // c: Mech itself. d: Code. e: none.
  let a: Member;
  let b: Member;
  let c: Member;
  let d: Member;
  let e: Member;

  beforeAll(async () => {
    const db = getDb();
    mech = await addSubteam(db, 'Mech');
    assembly = await addSubteam(db, 'Assembly', mech.id);
    cad = await addSubteam(db, 'CAD', mech.id);
    business = await addSubteam(db, 'Business');
    media = await addSubteam(db, 'Media', business.id);
    code = await addSubteam(db, 'Code');
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    a = await addMember(db, { firstName: 'Test', lastName: 'Member A', subteamIds: [assembly.id, cad.id] }, null);
    b = await addMember(db, { firstName: 'Test', lastName: 'Member B', subteamIds: [cad.id, media.id] }, null);
    c = await addMember(db, { firstName: 'Test', lastName: 'Member C', subteamIds: [mech.id] }, null);
    d = await addMember(db, { firstName: 'Test', lastName: 'Member D', subteamIds: [code.id] }, null);
    e = await addMember(db, { firstName: 'Test', lastName: 'Member E' }, null);
  });

  const lines = async (member: Member, title: string) =>
    (await openFor(getDb(), member.id, TODAY)).filter((h) => h.title === title);
  const rowsOf = (taskId: string) => getDb().select().from(assignments).where(eq(assignments.taskId, taskId));
  const published = async (input: TaskInput) => {
    const task = await createTask(getDb(), input, lead.id);
    await publishTask(getDb(), task.id, lead.id);
    return task;
  };

  it("lists each person's subteams in name order, and none for someone with none", async () => {
    const all = await listMembers(getDb());
    const named = (member: Member) => all.find((m) => m.id === member.id)?.subteams.map((s) => s.name);
    expect(named(a)).toEqual(['Assembly', 'CAD']);
    expect(named(b)).toEqual(['CAD', 'Media']);
    expect(named(c)).toEqual(['Mech']);
    expect(named(e)).toEqual([]);
  });

  it('lists subteams with the ones under each straight after it, and counts everyone a task would reach', async () => {
    const all = await listSubteams(getDb());
    expect(all.map((s) => s.name)).toEqual(['Business', 'Media', 'Code', 'Mech', 'Assembly', 'CAD']);
    const named = (name: string) => all.find((s) => s.name === name);
    expect(named('Assembly')).toMatchObject({ parentId: mech.id, parentName: 'Mech', members: 1 });
    expect(named('CAD')).toMatchObject({ parentName: 'Mech', members: 2 });
    // a, b and c: a is in two subteams under it and still counts once.
    expect(named('Mech')).toMatchObject({ parentId: null, parentName: null, members: 3 });
    expect(named('Business')).toMatchObject({ members: 1 });
    expect(named('Code')).toMatchObject({ members: 1 });
  });

  it('"everyone does their own" for a top subteam gives one copy to each person in it or under it', async () => {
    const task = await published({ title: 'Mech each', audience: 'subteam', subteamId: mech.id, completion: 'each' });
    const rows = await rowsOf(task.id);
    expect(rows.map((r) => r.memberId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await lines(a, 'Mech each')).toHaveLength(1);
    expect(await lines(d, 'Mech each')).toHaveLength(0);
    expect(await lines(e, 'Mech each')).toHaveLength(0);
    // One person finishing their own leaves the others' alone.
    const [mine] = await lines(a, 'Mech each');
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: mine.assignmentId, memberId: a.id, via: 'member_page', today: TODAY })).ok).toBe(true);
    expect(await lines(a, 'Mech each')).toHaveLength(0);
    expect(await lines(b, 'Mech each')).toHaveLength(1);
  });

  it('"done once" for a top subteam is one hand-out that everyone under it sees, and the first to finish ends it', async () => {
    const task = await published({ title: 'Mech once', audience: 'subteam', subteamId: mech.id, completion: 'once', steps: ['One', 'Two'] });
    expect(await rowsOf(task.id)).toHaveLength(1);
    for (const member of [a, b, c]) expect(await lines(member, 'Mech once')).toHaveLength(1);
    for (const member of [d, e]) expect(await lines(member, 'Mech once')).toHaveLength(0);
    const [shared] = await lines(b, 'Mech once');
    // Someone it reaches through a subteam under it can tick steps. Someone it does not reach cannot.
    expect((await setStepsDone(getDb(), { assignmentId: shared.assignmentId!, memberId: b.id, stepsDone: [0] })).ok).toBe(true);
    expect((await setStepsDone(getDb(), { assignmentId: shared.assignmentId!, memberId: d.id, stepsDone: [1] })).ok).toBe(false);
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: shared.assignmentId, memberId: d.id, via: 'kiosk', today: TODAY })).ok).toBe(false);
    expect((await markDone(getDb(), { taskId: task.id, assignmentId: shared.assignmentId, memberId: b.id, via: 'kiosk', today: TODAY })).ok).toBe(true);
    for (const member of [a, b, c]) expect(await lines(member, 'Mech once')).toHaveLength(0);
  });

  it('a task for a subteam under another stays there: not the one above it, not the one beside it', async () => {
    await published({ title: 'Assembly each', audience: 'subteam', subteamId: assembly.id, completion: 'each' });
    await published({ title: 'Assembly once', audience: 'subteam', subteamId: assembly.id });
    for (const title of ['Assembly each', 'Assembly once']) {
      expect(await lines(a, title)).toHaveLength(1);
      expect(await lines(b, title)).toHaveLength(0);
      expect(await lines(c, title)).toHaveLength(0);
    }
  });

  it("someone in two subteams gets both subteams' tasks", async () => {
    await published({ title: 'CAD job', audience: 'subteam', subteamId: cad.id });
    await published({ title: 'Media job', audience: 'subteam', subteamId: media.id, completion: 'each' });
    await published({ title: 'Business job', audience: 'subteam', subteamId: business.id });
    expect((await openFor(getDb(), b.id, TODAY)).filter((h) => ['CAD job', 'Media job', 'Business job'].includes(h.title)).map((h) => h.group)).toEqual(['subteam', 'subteam', 'subteam']);
    expect(await lines(a, 'CAD job')).toHaveLength(1);
    expect(await lines(a, 'Media job')).toHaveLength(0);
    expect(await lines(a, 'Business job')).toHaveLength(0);
  });

  it('leaving one subteam keeps what the other still brings, and drops the rest', async () => {
    const db = getDb();
    const each = await published({ title: 'Mech each, second', audience: 'subteam', subteamId: mech.id, completion: 'each' });
    const before = (await rowsOf(each.id)).find((r) => r.memberId === a.id);
    await updateMember(db, a.id, { subteamIds: [cad.id] }, lead.id);
    // Still under Mech through CAD: the same copy, not a new one.
    const after = (await rowsOf(each.id)).filter((r) => r.memberId === a.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before?.id, state: 'open' });
    expect(await lines(a, 'Assembly each')).toHaveLength(0);
    expect(await lines(a, 'Assembly once')).toHaveLength(0);
    expect(await lines(a, 'CAD job')).toHaveLength(1);
    // Out of every subteam: nothing from any of them.
    await updateMember(db, a.id, { subteamIds: [] }, lead.id);
    expect(await lines(a, 'Mech each, second')).toHaveLength(0);
    expect(await lines(a, 'CAD job')).toHaveLength(0);
    // Back in two: one copy again.
    await updateMember(db, a.id, { subteamIds: [assembly.id, cad.id] }, lead.id);
    expect(await lines(a, 'Mech each, second')).toHaveLength(1);
    expect(await lines(a, 'Assembly each')).toHaveLength(1);
  });

  it('someone switched off is not reached, and is again when switched back on', async () => {
    const db = getDb();
    const task = await published({ title: 'Mech each, third', audience: 'subteam', subteamId: mech.id, completion: 'each' });
    await setActive(db, c.id, false, lead.id);
    expect((await rowsOf(task.id)).filter((r) => r.memberId === c.id && r.state === 'open')).toHaveLength(0);
    expect((await listSubteams(db)).find((s) => s.name === 'Mech')?.members).toBe(2);
    await setActive(db, c.id, true, lead.id);
    expect((await rowsOf(task.id)).filter((r) => r.memberId === c.id && r.state === 'open')).toHaveLength(1);
  });

  it('counts someone as having a task when a subteam above theirs has one', async () => {
    const db = getDb();
    const team = await addSubteam(db, 'Field');
    const pit = await addSubteam(db, 'Pit', team.id);
    const f = await addMember(db, { firstName: 'Test', lastName: 'Member F', subteamIds: [pit.id] }, null);
    const g = await addMember(db, { firstName: 'Test', lastName: 'Member G', subteamIds: [pit.id, code.id] }, null);
    const nothing = async () => (await membersWithNothing(db, TODAY)).filter((m) => [f.id, g.id].includes(m.memberId));
    expect((await nothing()).map((m) => m.subteam)).toEqual(['Pit', 'Code, Pit']);
    await published({ title: 'Field once', audience: 'subteam', subteamId: team.id });
    expect(await nothing()).toEqual([]);
  });

  it('keeps subteams one level deep, and will not remove one that has subteams under it', async () => {
    const db = getDb();
    await expect(addSubteam(db, 'Too Deep', assembly.id)).rejects.toThrow(UserError);
    const top = await addSubteam(db, 'Drive');
    const under = await addSubteam(db, 'Pit Crew', top.id);
    await expect(removeSubteam(db, top.id, null)).rejects.toThrow(UserError);
    await removeSubteam(db, under.id, null);
    await removeSubteam(db, top.id, null);
    expect((await listSubteams(db)).some((s) => s.name === 'Drive')).toBe(false);
    // Asking for a name that exists hands back the one that is there, where it is.
    expect(await addSubteam(db, 'assembly', business.id)).toMatchObject({ id: assembly.id, parentId: mech.id });
  });

  it('ignores a subteam id that does not exist when saving a person', async () => {
    const db = getDb();
    const made = await addMember(db, { firstName: 'Test', lastName: 'Member H', subteamIds: [code.id, '00000000-0000-4000-8000-000000000000', code.id] }, null);
    expect((await listMembers(db)).find((m) => m.id === made.id)?.subteams.map((s) => s.name)).toEqual(['Code']);
  });

  it('a save that fails part-way leaves the person as they were', async () => {
    const db = getDb();
    // Nobody has this id, so writing who made the change fails after the subteams were written.
    const nobody = '00000000-0000-4000-8000-000000000000';
    await expect(updateMember(db, d.id, { subteamIds: [mech.id] }, nobody)).rejects.toThrow();
    expect((await listMembers(db)).find((m) => m.id === d.id)?.subteams.map((s) => s.name)).toEqual(['Code']);
    await expect(addMember(db, { firstName: 'Test', lastName: 'Half Made', subteamIds: [mech.id] }, nobody)).rejects.toThrow();
    expect((await listMembers(db)).some((m) => m.lastName === 'Half Made')).toBe(false);
  });

  it('a pasted roster can put one person in several subteams', async () => {
    const db = getDb();
    const result = await importRoster(db, 'Test Member P, Assembly; Media\nTest, Member Q, cad;New Crew ; \nTest Member R', null);
    expect(result).toMatchObject({ added: 3, skipped: [] });
    const all = await listMembers(db);
    const named = (last: string) => all.find((m) => m.lastName === last)?.subteams.map((s) => s.name);
    expect(named('Member P')).toEqual(['Assembly', 'Media']);
    expect(named('Member Q')).toEqual(['CAD', 'New Crew']);
    expect(named('Member R')).toEqual([]);
    expect((await listSubteams(db)).find((s) => s.name === 'New Crew')).toMatchObject({ parentId: null });
  });

  it('the migration copies the one subteam a person had before, once', async () => {
    const db = getDb();
    const [old] = await db
      .insert(members)
      .values({ firstName: 'Test', lastName: 'From Before', scanCode: newScanCode(), pageKey: newPageKey(), oldSubteamId: code.id })
      .returning();
    const copy = readFileSync('drizzle/0005_several_subteams.sql', 'utf8')
      .split('--> statement-breakpoint')
      .find((statement) => /insert into "member_subteams"/i.test(statement));
    expect(copy).toBeDefined();
    await db.execute(sql.raw(copy!));
    await db.execute(sql.raw(copy!));
    const rows = await db.select().from(memberSubteams).where(eq(memberSubteams.memberId, old.id));
    expect(rows.map((r) => r.subteamId)).toEqual([code.id]);
    // Nobody else gained or lost one.
    expect((await listMembers(db)).find((m) => m.id === d.id)?.subteams.map((s) => s.name)).toEqual(['Code']);
  });
});
