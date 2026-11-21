// The leads' season chart: people down the side, meeting days across. The people here are made up.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attendanceChart, recordScan, setByHand, strikeDay } from '@/lib/attendance';
import { attendance, members } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

// 5:30 PM Central on a day, as a moment.
const evening = (day: string) => new Date(`${day}T23:30:00Z`);

describe('attendance chart', () => {
  const getDb = useTestDb();

  async function person(lastName: string, countsFrom: string) {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Chart', lastName }, null);
    await db.update(members).set({ countsFrom }).where(eq(members.id, member.id));
    return member;
  }

  it('has a column for each meeting day and a mark where someone was here', async () => {
    const db = getDb();
    const a = await person('Person A', '2026-07-01');
    const b = await person('Person B', '2026-07-08');
    const gone = await person('Person C', '2026-07-01');
    await setActive(db, gone.id, false, null);
    const lead = await addMember(db, { firstName: 'Chart', lastName: 'Lead', role: 'lead' }, null);

    await recordScan(db, { memberId: a.id, at: evening('2026-07-06'), kioskId: null });
    await recordScan(db, { memberId: a.id, at: evening('2026-07-08'), kioskId: null });
    await recordScan(db, { memberId: b.id, at: evening('2026-07-08'), kioskId: null });
    await recordScan(db, { memberId: b.id, at: evening('2026-07-10'), kioskId: null });
    // A day of test scans a lead struck out is not a column.
    await recordScan(db, { memberId: a.id, at: evening('2026-07-13'), kioskId: null });
    await strikeDay(db, '2026-07-13', null);
    // A day with only a row added by hand is not a meeting day, as on a person's own count.
    await setByHand(db, { memberId: a.id, day: '2026-07-15', present: true, actorId: lead.id, at: new Date() });
    // Outside the range asked for.
    await recordScan(db, { memberId: a.id, at: evening('2026-08-03'), kioskId: null });

    const chart = await attendanceChart(db, { from: '2026-07-01', to: '2026-07-31' });
    expect(chart.days).toEqual(['2026-07-06', '2026-07-08', '2026-07-10']);
    // Only people still on the team, by name.
    const mine = chart.rows.filter((r) => [a.id, b.id, gone.id].includes(r.memberId));
    expect(mine.map((r) => r.fullName)).toEqual(['Chart Person A', 'Chart Person B']);

    const [rowA, rowB] = mine;
    expect(rowA.here).toEqual(['2026-07-06', '2026-07-08']);
    expect(rowA).toMatchObject({ attended: 2, counted: 3 });
    // B joined on the 8th, so the 6th is not held against them.
    expect(rowB.here).toEqual(['2026-07-08', '2026-07-10']);
    expect(rowB.since).toBe('2026-07-08');
    expect(rowB).toMatchObject({ attended: 2, counted: 2 });
    expect(chart.dayTotals).toEqual([1, 2, 1]);
  });

  it('shows a change made by hand straight away', async () => {
    const db = getDb();
    const a = await person('Person A', '2026-09-01');
    const b = await person('Person B', '2026-09-01');
    const lead = await addMember(db, { firstName: 'Chart', lastName: 'Lead Two', role: 'lead' }, null);
    await recordScan(db, { memberId: a.id, at: evening('2026-09-07'), kioskId: null });
    await recordScan(db, { memberId: a.id, at: evening('2026-09-09'), kioskId: null });

    await setByHand(db, { memberId: b.id, day: '2026-09-09', present: true, actorId: lead.id, at: new Date() });
    await setByHand(db, { memberId: a.id, day: '2026-09-07', present: false, actorId: lead.id, at: new Date() });

    const chart = await attendanceChart(db, { from: '2026-09-01', to: '2026-09-30' });
    // Unmarking the only person on the 7th leaves it with no kiosk or sheet row, so it is no longer a meeting day.
    expect(chart.days).toEqual(['2026-09-09']);
    expect(chart.rows.find((r) => r.memberId === b.id)?.here).toEqual(['2026-09-09']);
    expect(chart.dayTotals).toEqual([2]);
    expect(await db.select().from(attendance).where(eq(attendance.memberId, b.id))).toHaveLength(1);
  });

  it('is empty, not broken, when nothing happened in the range', async () => {
    const db = getDb();
    const a = await person('Person D', '2026-06-01');
    const chart = await attendanceChart(db, { from: '2026-06-01', to: '2026-06-30' });
    expect(chart.days).toEqual([]);
    // The file's database is shared by its tests, so look only at this test's person.
    expect(chart.rows.find((r) => r.memberId === a.id)).toMatchObject({ here: [], attended: 0, counted: 0 });
    expect(chart.dayTotals).toEqual([]);
  });
});
