import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attendanceRows, meetingDays, memberCount, recordScan, setByHand, strikeDay, todayBoard } from '@/lib/attendance';
import { importSheet, parseSheet, SheetError } from '@/lib/attendance-sheet';
import { attendance, changeLog, members } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

// Made-up people. Ten meeting days, the way a season's sheet has them.
const DAYS = ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17', '2026-09-22', '2026-09-24', '2026-09-29', '2026-10-01'];
const row = (name: string, marks: string) => [name, ...[...marks].map((m) => (m === '1' ? 'TRUE' : 'FALSE'))].join(',');
const FILE = [
  ['name', ...DAYS].join(','),
  row('Sheet Person A', '1101011010'), // 6
  row('Sheet Person B', '0000000001'), // 1
  row('Sheet Person C', '0000000000'), // 0
  row('Sheet Person D', '1111111111'), // 10
].join('\r\n');
const NOW = new Date('2026-11-20T04:00:00Z'); // 10:00 PM Central, 11-19
const ALL = { from: '2000-01-01', to: '2999-12-31' };
const count = async (db: ReturnType<ReturnType<typeof useTestDb>>, table: typeof members | typeof attendance) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n;

describe('bringing in a season from the attendance sheet', () => {
  const getDb = useTestDb();

  it('adds the people who are not on the roster and one row for each mark, and a second run adds nothing', async () => {
    const db = getDb();
    const before = { people: await count(db, members), rows: await count(db, attendance) };
    const first = await importSheet(db, parseSheet(FILE), NOW);
    expect(first).toEqual({ people: 4, days: 10, marks: 17, peopleAdded: 4, rowsAdded: 17 });
    // Read back from the database, not from the importer's own totals.
    expect(await count(db, members)).toBe(before.people + 4);
    expect(await count(db, attendance)).toBe(before.rows + 17);
    expect(await meetingDays(db, ALL)).toEqual(DAYS);
    const perDay = await db
      .select({ day: attendance.day, n: sql<number>`count(*)::int` })
      .from(attendance)
      .groupBy(attendance.day)
      .orderBy(attendance.day);
    expect(perDay.map((d) => d.n)).toEqual([2, 2, 1, 2, 1, 2, 2, 1, 2, 2]);

    const second = await importSheet(db, parseSheet(FILE), new Date(NOW.getTime() + 60_000));
    expect(second).toEqual({ people: 4, days: 10, marks: 17, peopleAdded: 0, rowsAdded: 0 });
    expect(await count(db, members)).toBe(before.people + 4);
    expect(await count(db, attendance)).toBe(before.rows + 17);
    const logged = await db.select().from(changeLog).where(eq(changeLog.action, 'attendance.import'));
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBeNull();
    expect(logged[0].detail).toEqual({ people: 4, peopleAdded: 4, days: 10, marks: 17, rowsAdded: 17, firstDay: '2026-09-01', lastDay: '2026-10-01' });
  });

  it('stores no scan time for a row from the sheet, and says when the row was made', async () => {
    const db = getDb();
    await importSheet(db, parseSheet(FILE), NOW);
    const [b] = await db.select().from(members).where(eq(members.lastName, 'Person B'));
    const rows = await db.select().from(attendance).where(eq(attendance.memberId, b.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: '2026-10-01', source: 'sheet', firstScanAt: null, recordedById: null, kioskId: null });
    expect(rows[0].addedAt.toISOString()).toBe(NOW.toISOString());
    // The made day of the person is the real one, not a day from the sheet.
    expect(b.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("counts a person's meetings from the sheet's first day, so someone added tonight reads 6 of 10", async () => {
    const db = getDb();
    await importSheet(db, parseSheet(FILE), NOW);
    const today = '2026-11-19';
    const of = async (lastName: string) => {
      const [m] = await db.select().from(members).where(eq(members.lastName, lastName));
      return memberCount(db, m.id, today);
    };
    expect(await of('Person A')).toEqual({ attended: 6, meetingDays: 10, since: '2026-09-01' });
    expect(await of('Person B')).toEqual({ attended: 1, meetingDays: 10, since: '2026-09-01' });
    expect(await of('Person C')).toEqual({ attended: 0, meetingDays: 10, since: '2026-09-01' });
    expect(await of('Person D')).toEqual({ attended: 10, meetingDays: 10, since: '2026-09-01' });
  });

  it('leaves the count of someone who is not in the file where it was', async () => {
    const db = getDb();
    await importSheet(db, parseSheet(FILE), NOW);
    const other = await addMember(db, { firstName: 'Not', lastName: 'In The File' }, null);
    const made = (await memberCount(db, other.id, '2999-01-01')).since;
    expect(made > '2026-10-01').toBe(true);
    expect(await memberCount(db, other.id, made)).toMatchObject({ attended: 0, meetingDays: 0 });
  });

  it('uses the person already on the roster, in any letter case, and keeps a row they already have', async () => {
    const db = getDb();
    const here = await addMember(db, { firstName: 'sheet', lastName: 'PERSON  E' }, null);
    const scanAt = new Date('2026-09-08T22:30:00Z');
    await recordScan(db, { memberId: here.id, at: scanAt, kioskId: null });
    const off = await addMember(db, { firstName: 'Sheet', lastName: 'Person F' }, null);
    await setActive(db, off.id, false, null);
    const file = [['name', '2026-09-01', '2026-09-08'].join(','), 'Sheet Person E,TRUE,TRUE', 'Sheet Person F,TRUE,FALSE'].join('\n');
    const people = await count(db, members);
    const result = await importSheet(db, parseSheet(file), NOW);
    expect(result).toMatchObject({ peopleAdded: 0, rowsAdded: 2, marks: 3 });
    expect(await count(db, members)).toBe(people);
    const rows = await db.select().from(attendance).where(eq(attendance.memberId, here.id)).orderBy(attendance.day);
    expect(rows.map((r) => [r.day, r.source])).toEqual([['2026-09-01', 'sheet'], ['2026-09-08', 'kiosk']]);
    expect(rows[1].firstScanAt?.toISOString()).toBe(scanAt.toISOString());
    // Their count now runs from the sheet's first day too.
    expect(await memberCount(db, here.id, '2026-11-19')).toMatchObject({ attended: 2, since: '2026-09-01' });
    // Someone switched off stays switched off.
    const [after] = await db.select().from(members).where(eq(members.id, off.id));
    expect(after.active).toBe(false);
  });

  it('refuses a name that two people on the roster share, and changes nothing', async () => {
    const db = getDb();
    await addMember(db, { firstName: 'Sheet', lastName: 'Twin' }, null);
    await addMember(db, { firstName: 'sheet', lastName: 'twin' }, null);
    const file = 'name,2026-09-01\nSheet New,TRUE\nSheet Twin,TRUE\n';
    const before = { people: await count(db, members), rows: await count(db, attendance) };
    await expect(importSheet(db, parseSheet(file), NOW)).rejects.toThrow(SheetError);
    await expect(importSheet(db, parseSheet(file), NOW)).rejects.toThrow(/Line 3/);
    expect({ people: await count(db, members), rows: await count(db, attendance) }).toEqual(before);
  });

  it('a day with only by-hand rows is still not a meeting day, and a struck sheet day does not count', async () => {
    const db = getDb();
    await importSheet(db, parseSheet('name,2026-08-04,2026-08-06\nSheet Person G,TRUE,TRUE\n'), NOW);
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead G', role: 'lead' }, null);
    const [g] = await db.select().from(members).where(eq(members.lastName, 'Person G'));
    await setByHand(db, { memberId: g.id, day: '2026-08-11', present: true, actorId: lead.id, at: NOW });
    const range = { from: '2026-08-01', to: '2026-08-31' };
    expect(await meetingDays(db, range)).toEqual(['2026-08-04', '2026-08-06']);
    await strikeDay(db, '2026-08-06', lead.id);
    expect(await meetingDays(db, range)).toEqual(['2026-08-04']);
  });

  it('shows on the screens as a sheet row: here for that day, no time, and a lead can unmark it', async () => {
    const db = getDb();
    await importSheet(db, parseSheet('name,2026-07-07\nSheet Person H,TRUE\nSheet Person I,FALSE\n'), NOW);
    const board = await todayBoard(db, '2026-07-07');
    const h = board.here.find((r) => r.fullName === 'Sheet Person H');
    expect(h).toMatchObject({ source: 'sheet', firstScanAt: null });
    expect(board.notHere.map((r) => r.fullName)).toContain('Sheet Person I');
    expect(board.here.map((r) => r.fullName)).not.toContain('Sheet Person I');
    const listed = (await attendanceRows(db, { from: '2026-07-07', to: '2026-07-07' })).find((r) => r.lastName === 'Person H');
    expect(listed).toMatchObject({ source: 'sheet', firstScanAt: null, recordedBy: '' });
    expect(listed?.addedAt.toISOString()).toBe(NOW.toISOString());

    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead H', role: 'lead' }, null);
    await setByHand(db, { memberId: h!.memberId, day: '2026-07-07', present: false, actorId: lead.id, at: NOW });
    const left = await db.select().from(attendance).where(and(eq(attendance.memberId, h!.memberId), eq(attendance.day, '2026-07-07')));
    expect(left).toHaveLength(0);
    const [logged] = await db.select().from(changeLog).where(and(eq(changeLog.action, 'attendance.remove_by_hand'), eq(changeLog.entityId, h!.memberId)));
    expect(logged.detail).toEqual({ day: '2026-07-07', was: 'sheet', firstScanAt: null });
  });

  it('a scan and a by-hand row still say when they were made', async () => {
    const db = getDb();
    const m = await addMember(db, { firstName: 'Sheet', lastName: 'Person J' }, null);
    const at = new Date('2026-11-18T23:30:00Z');
    await recordScan(db, { memberId: m.id, at, kioskId: null });
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead J', role: 'lead' }, null);
    await setByHand(db, { memberId: m.id, day: '2026-11-10', present: true, actorId: lead.id, at });
    const rows = await db.select().from(attendance).where(eq(attendance.memberId, m.id));
    expect(rows.map((r) => r.addedAt.toISOString())).toEqual([at.toISOString(), at.toISOString()]);
  });
});
