// Setting people's subteams from a file. The people here are made up.
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SheetError } from '@/lib/attendance-sheet';
import { assignments, changeLog, memberSubteams, members, subteams, type Member, type Subteam } from '@/lib/db/schema';
import { addMember, addSubteam, listMembers, setActive } from '@/lib/members';
import { parseSubteamSheet, setSubteamsFromSheet } from '@/lib/subteam-sheet';
import { createTask, openFor, publishTask } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

describe("setting people's subteams from a file", () => {
  const getDb = useTestDb();
  let mech: Subteam;
  let cad: Subteam;
  let a: Member;
  let b: Member;
  let c: Member;
  let off: Member;

  beforeAll(async () => {
    const db = getDb();
    mech = await addSubteam(db, 'Mech + Electrical');
    await addSubteam(db, 'Assembly', mech.id);
    cad = await addSubteam(db, 'CAD', mech.id);
    await addSubteam(db, 'Media');
    a = await addMember(db, { firstName: 'Sheet', lastName: 'Person A' }, null);
    b = await addMember(db, { firstName: 'Sheet', lastName: 'Person B', subteamIds: [cad.id] }, null);
    c = await addMember(db, { firstName: 'Sheet', lastName: 'Person C', subteamIds: [cad.id] }, null);
    off = await addMember(db, { firstName: 'Sheet', lastName: 'Person Off' }, null);
    await setActive(db, off.id, false, null);
  });

  const named = async (member: Member) => (await listMembers(getDb())).find((m) => m.id === member.id)?.subteams.map((s) => s.name);
  const count = async (table: typeof members | typeof subteams | typeof memberSubteams) =>
    (await getDb().select({ n: sql<number>`count(*)::int` }).from(table))[0].n;

  it('puts each person in exactly the subteams on their line, and their tasks follow', async () => {
    const db = getDb();
    const task = await createTask(db, { title: 'Mech job', audience: 'subteam', subteamId: mech.id, completion: 'each' }, null);
    await publishTask(db, task.id, null);
    const before = { people: await count(members), teams: await count(subteams) };
    const file = ['name,subteams', 'sheet  person a, assembly; MEDIA', 'Sheet Person B,', 'Sheet Person Off,cad'].join('\n');
    const result = await setSubteamsFromSheet(db, parseSubteamSheet(file));
    expect(result).toEqual({ people: 3, changed: 3, inNone: 1, places: 3 });
    expect(await named(a)).toEqual(['Assembly', 'Media']);
    expect(await named(b)).toEqual([]);
    expect(await named(off)).toEqual(['CAD']);
    // Not in the file: left as they were.
    expect(await named(c)).toEqual(['CAD']);
    // Nobody and no subteam was added.
    expect({ people: await count(members), teams: await count(subteams) }).toEqual(before);
    // a is under Mech now and holds its task; b has left and does not.
    expect((await openFor(db, a.id, '2026-11-19')).map((h) => h.title)).toEqual(['Mech job']);
    expect(await openFor(db, b.id, '2026-11-19')).toEqual([]);
    const live = await db.select().from(assignments).where(eq(assignments.taskId, task.id));
    expect(live.filter((r) => r.state === 'open').map((r) => r.memberId).sort()).toEqual([a.id, c.id].sort());
    // Each person who changed has a line in the change log, with no name in it.
    const logged = await db.select().from(changeLog).where(eq(changeLog.action, 'member.edit'));
    expect(logged.map((l) => l.detail)).toEqual([{ fields: ['subteams'] }, { fields: ['subteams'] }, { fields: ['subteams'] }]);
  });

  it('changes nothing on a second run of the same file', async () => {
    const file = 'Sheet Person A,Media;Assembly\nSheet Person B\nSheet Person Off,CAD\n';
    const places = await count(memberSubteams);
    expect(await setSubteamsFromSheet(getDb(), parseSubteamSheet(file))).toEqual({ people: 3, changed: 0, inNone: 1, places: 3 });
    expect(await count(memberSubteams)).toBe(places);
  });

  it('stops before changing anything when a name or a subteam is not known, and says which lines', async () => {
    const db = getDb();
    await addMember(db, { firstName: 'Sheet', lastName: 'Twin' }, null);
    await addMember(db, { firstName: 'sheet', lastName: 'twin' }, null);
    const file = ['Sheet Person A,CAD', 'Sheet Person Nobody,CAD', 'Sheet Person B,No Such Crew', 'Sheet Twin,CAD', 'Sheet Person Else,CAD'].join('\n');
    const places = await count(memberSubteams);
    let message = '';
    try {
      await setSubteamsFromSheet(db, parseSubteamSheet(file));
    } catch (error) {
      expect(error).toBeInstanceOf(SheetError);
      message = (error as Error).message;
    }
    expect(message).toBe(
      'Nothing was changed. A name that is not on the roster: lines 2, 5. A name two people on the roster share: line 4. A subteam that does not exist: line 3.',
    );
    expect(await named(a)).toEqual(['Assembly', 'Media']);
    expect(await count(memberSubteams)).toBe(places);
    expect((await db.select().from(subteams)).some((s) => s.name === 'No Such Crew')).toBe(false);
  });
});
