// The leads' attendance graph: a bar for each meeting day, then everyone with the lowest share first. The people here are made up.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attendanceGraph, recordScan } from '@/lib/attendance';
import { members } from '@/lib/db/schema';
import { addMember, addSubteam } from '@/lib/members';
import { useTestDb } from '../setup/db';

// 5:30 PM Central on a day, as a moment.
const evening = (day: string) => new Date(`${day}T23:30:00Z`);

describe('attendance graph', () => {
  const getDb = useTestDb();

  async function person(lastName: string, countsFrom: string, subteamIds: string[] = []) {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Graph', lastName, subteamIds }, null);
    await db.update(members).set({ countsFrom }).where(eq(members.id, member.id));
    return member;
  }

  it('has a bar for each meeting day with who came, who missed, and how many could have come', async () => {
    const db = getDb();
    const a = await person('Person A', '2026-03-01');
    const b = await person('Person B', '2026-03-01');
    // Joined after the first meeting: not missing from it, and not counted in its "of".
    const c = await person('Person C', '2026-03-04');
    await recordScan(db, { memberId: a.id, at: evening('2026-03-02'), kioskId: null });
    await recordScan(db, { memberId: a.id, at: evening('2026-03-04'), kioskId: null });
    await recordScan(db, { memberId: c.id, at: evening('2026-03-04'), kioskId: null });
    await recordScan(db, { memberId: b.id, at: evening('2026-03-06'), kioskId: null });

    const graph = await attendanceGraph(db, { from: '2026-03-01', to: '2026-03-31', subteamId: null });
    const mine = <T extends { memberId: string }>(names: T[]) => names.filter((n) => [a.id, b.id, c.id].includes(n.memberId));
    expect(graph.days.map((d) => d.day)).toEqual(['2026-03-02', '2026-03-04', '2026-03-06']);

    const [second, fourth, sixth] = graph.days;
    expect(mine(second.hereNames).map((n) => n.fullName)).toEqual(['Graph Person A']);
    expect(mine(second.missedNames).map((n) => n.fullName)).toEqual(['Graph Person B']);
    expect(mine(fourth.hereNames).map((n) => n.fullName)).toEqual(['Graph Person A', 'Graph Person C']);
    expect(mine(fourth.missedNames).map((n) => n.fullName)).toEqual(['Graph Person B']);
    expect(mine(sixth.missedNames).map((n) => n.fullName)).toEqual(['Graph Person A', 'Graph Person C']);
    // Each bar's numbers are its own lists, so the bar and the lists never disagree.
    for (const d of graph.days) {
      expect(d.here).toBe(d.hereNames.length);
      expect(d.of).toBe(d.hereNames.length + d.missedNames.length);
    }
  });

  it('lists everyone with the lowest share first, with their last meetings', async () => {
    const db = getDb();
    const a = await person('Person D', '2026-04-01');
    const b = await person('Person E', '2026-04-01');
    const late = await person('Person F', '2026-04-30');
    for (const day of ['2026-04-06', '2026-04-08', '2026-04-10']) {
      await recordScan(db, { memberId: a.id, at: evening(day), kioskId: null });
    }
    await recordScan(db, { memberId: b.id, at: evening('2026-04-08'), kioskId: null });

    const graph = await attendanceGraph(db, { from: '2026-04-01', to: '2026-04-30', subteamId: null });
    const mine = graph.people.filter((p) => [a.id, b.id, late.id].includes(p.memberId));
    // E came to 1 of 3, D to 3 of 3. F joined after the last meeting, so has nothing to count yet and goes last.
    expect(mine.map((p) => p.fullName)).toEqual(['Graph Person E', 'Graph Person D', 'Graph Person F']);
    expect(mine[0]).toMatchObject({ attended: 1, counted: 3, share: 33 });
    expect(mine[1]).toMatchObject({ attended: 3, counted: 3, share: 100 });
    expect(mine[2]).toMatchObject({ attended: 0, counted: 0, share: null });
    // Oldest first, one mark for each meeting day.
    expect(mine[0].last).toEqual(['missed', 'here', 'missed']);
    expect(mine[2].last).toEqual(['before', 'before', 'before']);
  });

  it('keeps only the last eight meetings in the marks', async () => {
    const db = getDb();
    const a = await person('Person G', '2026-05-01');
    const days = ['01', '04', '06', '08', '11', '13', '15', '18', '20', '22'].map((d) => `2026-05-${d}`);
    for (const day of days) await recordScan(db, { memberId: a.id, at: evening(day), kioskId: null });

    const graph = await attendanceGraph(db, { from: '2026-05-01', to: '2026-05-31', subteamId: null });
    const row = graph.people.find((p) => p.memberId === a.id);
    expect(row?.last).toHaveLength(8);
    expect(row).toMatchObject({ attended: 10, counted: 10, share: 100 });
  });

  it('narrows to a subteam and the subteams under it, on the same meeting days', async () => {
    const db = getDb();
    const mech = await addSubteam(db, 'Graph Mech');
    const assembly = await addSubteam(db, 'Graph Assembly', mech.id);
    const media = await addSubteam(db, 'Graph Media');
    const inMech = await person('Person H', '2026-06-01', [mech.id]);
    // In two subteams, both under Mech: counted once.
    const inAssembly = await person('Person I', '2026-06-01', [assembly.id, media.id]);
    const elsewhere = await person('Person J', '2026-06-01', [media.id]);
    await recordScan(db, { memberId: inMech.id, at: evening('2026-06-01'), kioskId: null });
    await recordScan(db, { memberId: inAssembly.id, at: evening('2026-06-01'), kioskId: null });
    // Only someone outside Mech came on the 3rd. It is still a meeting day for Mech, with nobody from Mech there.
    await recordScan(db, { memberId: elsewhere.id, at: evening('2026-06-03'), kioskId: null });

    const graph = await attendanceGraph(db, { from: '2026-06-01', to: '2026-06-30', subteamId: mech.id });
    expect(graph.days.map((d) => d.day)).toEqual(['2026-06-01', '2026-06-03']);
    expect(graph.days.map((d) => [d.here, d.of])).toEqual([
      [2, 2],
      [0, 2],
    ]);
    expect(graph.people.map((p) => p.fullName).sort()).toEqual(['Graph Person H', 'Graph Person I']);

    const all = await attendanceGraph(db, { from: '2026-06-01', to: '2026-06-30', subteamId: null });
    expect(all.people.map((p) => p.memberId)).toContain(elsewhere.id);
  });

  it('is empty, not broken, when nothing happened in the range', async () => {
    const db = getDb();
    await person('Person K', '2026-01-01');
    const graph = await attendanceGraph(db, { from: '2026-01-01', to: '2026-01-31', subteamId: null });
    expect(graph.days).toEqual([]);
    expect(graph.people.every((p) => p.counted === 0 && p.share === null)).toBe(true);
  });
});
