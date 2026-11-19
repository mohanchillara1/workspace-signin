import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { attendance, type Member } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { handleScan } from '@/lib/scan';
import { createTask, publishTask } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

describe('the scan', () => {
  const getDb = useTestDb();
  let member: Member;
  const rowsFor = (id: string) => getDb().select().from(attendance).where(eq(attendance.memberId, id));

  beforeAll(async () => {
    const db = getDb();
    member = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, null);
    const task = await createTask(db, { title: 'Sort the bolt bins', audience: 'person', memberIds: [member.id] }, null);
    await publishTask(db, task.id, null);
  });

  it('signs a known member in and shows their tasks', async () => {
    const result = await handleScan(getDb(), { code: member.scanCode, kioskId: null, now: new Date('2026-11-18T23:00:00Z') });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.firstName).toBe('Test');
    expect(result.name).toBe('Test M.');
    expect(result.firstToday).toBe(true);
    expect(result.day).toBe('2026-11-18');
    expect(result.tasks?.map((t) => t.title)).toEqual(['Sort the bolt bins']);
    expect(await rowsFor(member.id)).toHaveLength(1);
  });

  it('still records attendance when the task side fails', async () => {
    const db = getDb();
    const other = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
    const result = await handleScan(
      db,
      { code: other.scanCode, kioskId: null, now: new Date('2026-11-18T23:01:00Z') },
      {
        loadTasks: async () => {
          throw new Error('the task side is down');
        },
      },
    );
    expect(result).toMatchObject({ status: 'ok', firstToday: true, tasks: null });
    const rows = await rowsFor(other.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe('2026-11-18');
  });

  it('still signs the member in when the scan limiter itself fails', async () => {
    const db = getDb();
    const other = await addMember(db, { firstName: 'Test', lastName: 'Member L' }, null);
    const result = await handleScan(
      db,
      { code: other.scanCode, kioskId: null, now: new Date('2026-11-18T23:03:00Z') },
      {
        count: async () => {
          throw new Error('the counter table is gone');
        },
      },
    );
    expect(result.status).toBe('ok');
    expect(await rowsFor(other.id)).toHaveLength(1);
  });

  it('makes one row when the same code arrives ten times at once', async () => {
    const db = getDb();
    const other = await addMember(db, { firstName: 'Test', lastName: 'Member C' }, null);
    const now = new Date('2026-11-18T23:02:00Z');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => handleScan(db, { code: other.scanCode, kioskId: null, now })),
    );
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(results.filter((r) => r.status === 'ok' && r.firstToday)).toHaveLength(1);
    expect(await rowsFor(other.id)).toHaveLength(1);
  });

  it('answers "unknown" to anything that is not an active member code', async () => {
    const db = getDb();
    const gone = await addMember(db, { firstName: 'Test', lastName: 'Gone' }, null);
    await setActive(db, gone.id, false, null);
    const before = (await db.select().from(attendance)).length;
    const strange: unknown[] = [
      'SR1-00000000000000000000000000',
      gone.scanCode,
      '',
      'https://example.com/?q=SR1-00000000000000000000000000',
      'WIFI:T:WPA;S:workspace;P:hunter2;;',
      'x'.repeat(2000),
      '🤖🤖🤖',
      member.scanCode.toLowerCase(),
      ` ${member.scanCode}`,
      null,
      42,
      { code: member.scanCode },
    ];
    let minute = 10;
    for (const code of strange) {
      // A new minute each time, so the unknown-code limit is not what answers.
      const now = new Date(`2026-11-18T23:${String(minute++).padStart(2, '0')}:00Z`);
      expect(await handleScan(db, { code, kioskId: null, now })).toEqual({ status: 'unknown' });
    }
    expect((await db.select().from(attendance)).length).toBe(before);
  });

  it('slows a kiosk down after 60 scans in a minute', async () => {
    const db = getDb();
    const now = new Date('2026-11-18T23:40:00Z');
    for (let i = 0; i < 60; i++) {
      expect((await handleScan(db, { code: member.scanCode, kioskId: null, now })).status).toBe('ok');
    }
    expect(await handleScan(db, { code: member.scanCode, kioskId: null, now })).toEqual({ status: 'slow_down' });
  });

  it('slows a kiosk down after 10 unknown codes in a minute', async () => {
    const db = getDb();
    const now = new Date('2026-11-18T23:45:00Z');
    for (let i = 0; i < 10; i++) {
      expect((await handleScan(db, { code: 'nope', kioskId: null, now })).status).toBe('unknown');
    }
    expect((await handleScan(db, { code: 'nope', kioskId: null, now })).status).toBe('slow_down');
  });
});
