import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  attendanceRows,
  meetingDays,
  memberCount,
  recordScan,
  setByHand,
  strikeDay,
  todayBoard,
  unstrikeDay,
} from '@/lib/attendance';
import { attendance, changeLog, members } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

const EVENING = new Date('2026-11-18T23:30:00Z'); // 5:30 PM Central, 11-18

describe('attendance', () => {
  const getDb = useTestDb();

  it('keeps one row for two scans on one Central day', async () => {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    const first = await recordScan(db, { memberId: member.id, at: EVENING, kioskId: null });
    const second = await recordScan(db, { memberId: member.id, at: new Date('2026-11-19T01:00:00Z'), kioskId: null });
    expect(first).toEqual({ day: '2026-11-18', firstToday: true });
    expect(second).toEqual({ day: '2026-11-18', firstToday: false });
    const rows = await db.select().from(attendance).where(eq(attendance.memberId, member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].firstScanAt.toISOString()).toBe(EVENING.toISOString());
    expect(rows[0].source).toBe('kiosk');
  });

  it('starts a new day at midnight Central', async () => {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
    await recordScan(db, { memberId: member.id, at: new Date('2026-11-20T05:59:00Z'), kioskId: null });
    await recordScan(db, { memberId: member.id, at: new Date('2026-11-20T06:00:00Z'), kioskId: null });
    const rows = await db.select().from(attendance).where(eq(attendance.memberId, member.id));
    expect(rows.map((r) => r.day).sort()).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('records a by-hand row with who made it, and logs adding and removing', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member C' }, null);
    await setByHand(db, { memberId: member.id, day: '2026-11-10', present: true, actorId: lead.id, at: EVENING });
    const [row] = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.memberId, member.id), eq(attendance.day, '2026-11-10')));
    expect(row.source).toBe('manual');
    expect(row.recordedById).toBe(lead.id);
    await setByHand(db, { memberId: member.id, day: '2026-11-10', present: false, actorId: lead.id, at: EVENING });
    const after = await db.select().from(attendance).where(eq(attendance.memberId, member.id));
    expect(after).toHaveLength(0);
    const all = await db.select().from(changeLog).where(eq(changeLog.entityId, member.id));
    const logged = all.filter((l) => l.action.startsWith('attendance.'));
    expect(logged.map((l) => l.action).sort()).toEqual(['attendance.add_by_hand', 'attendance.remove_by_hand']);
    expect(logged.every((l) => l.actorId === lead.id)).toBe(true);
  });

  it('counts a day as a meeting day only if a kiosk scan happened and nobody struck it', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member D' }, null);
    await db.update(members).set({ createdAt: new Date('2026-12-01T12:00:00Z') }).where(eq(members.id, member.id));
    await recordScan(db, { memberId: lead.id, at: new Date('2026-12-01T23:00:00Z'), kioskId: null }); // before D joined? no: same day
    await recordScan(db, { memberId: lead.id, at: new Date('2026-12-03T23:00:00Z'), kioskId: null });
    await recordScan(db, { memberId: member.id, at: new Date('2026-12-03T23:05:00Z'), kioskId: null });
    await recordScan(db, { memberId: lead.id, at: new Date('2026-12-05T23:00:00Z'), kioskId: null });
    await setByHand(db, { memberId: member.id, day: '2026-12-07', present: true, actorId: lead.id, at: EVENING });
    const range = { from: '2026-12-01', to: '2026-12-31' };
    expect(await meetingDays(db, range)).toEqual(['2026-12-01', '2026-12-03', '2026-12-05']);
    await strikeDay(db, '2026-12-05', lead.id);
    expect(await meetingDays(db, range)).toEqual(['2026-12-01', '2026-12-03']);
    expect(await memberCount(db, member.id, '2026-12-31')).toEqual({ attended: 1, meetingDays: 2, since: '2026-12-01' });
    await unstrikeDay(db, '2026-12-05', lead.id);
    expect(await memberCount(db, member.id, '2026-12-31')).toEqual({ attended: 1, meetingDays: 3, since: '2026-12-01' });
  });

  it('does not count meeting days from before the member was added', async () => {
    const db = getDb();
    const early = await addMember(db, { firstName: 'Test', lastName: 'Early' }, null);
    const late = await addMember(db, { firstName: 'Test', lastName: 'Late' }, null);
    await db.update(members).set({ createdAt: new Date('2027-01-10T18:00:00Z') }).where(eq(members.id, late.id));
    await recordScan(db, { memberId: early.id, at: new Date('2027-01-05T23:00:00Z'), kioskId: null });
    await recordScan(db, { memberId: early.id, at: new Date('2027-01-12T23:00:00Z'), kioskId: null });
    await recordScan(db, { memberId: late.id, at: new Date('2027-01-12T23:00:00Z'), kioskId: null });
    const count = await memberCount(db, late.id, '2027-01-31');
    expect(count.since).toBe('2027-01-10');
    expect(count.meetingDays).toBe(1);
    expect(count.attended).toBe(1);
  });

  it('splits active members into here and not here for a day', async () => {
    const db = getDb();
    const here = await addMember(db, { firstName: 'Here', lastName: 'Person' }, null);
    const away = await addMember(db, { firstName: 'Away', lastName: 'Person' }, null);
    const gone = await addMember(db, { firstName: 'Gone', lastName: 'Person' }, null);
    await setActive(db, gone.id, false, null);
    await recordScan(db, { memberId: here.id, at: new Date('2027-02-02T23:00:00Z'), kioskId: null });
    const board = await todayBoard(db, '2027-02-02');
    expect(board.here.map((r) => r.memberId)).toContain(here.id);
    expect(board.notHere.map((r) => r.memberId)).toContain(away.id);
    expect([...board.here, ...board.notHere].map((r) => r.memberId)).not.toContain(gone.id);
    expect(board.here.find((r) => r.memberId === here.id)?.name).toBe('Here P.');
  });

  it('lists rows for the export with full names and how each was recorded', async () => {
    const db = getDb();
    const rows = await attendanceRows(db, { from: '2026-11-18', to: '2026-11-18' });
    const row = rows.find((r) => r.lastName === 'Member A');
    expect(row).toMatchObject({ day: '2026-11-18', firstName: 'Test', source: 'kiosk', recordedBy: '' });
  });
});
