import { describe, expect, it } from 'vitest';
import { assignments, attendance, members, submissions, tasks } from '@/lib/db/schema';
import { newPageKey, newScanCode } from '@/lib/ids';
import { useTestDb } from '../setup/db';

describe('schema', () => {
  const getDb = useTestDb();

  it('refuses a second attendance row for one member on one day', async () => {
    const db = getDb();
    const [member] = await db
      .insert(members)
      .values({ firstName: 'Test', lastName: 'Member A', scanCode: newScanCode(), pageKey: newPageKey() })
      .returning();
    const row = { memberId: member.id, day: '2026-11-18', firstScanAt: new Date(), source: 'kiosk' as const };
    await db.insert(attendance).values(row);
    await expect(db.insert(attendance).values(row)).rejects.toThrow();
  });

  it('a member can have one Slack id, and no two members the same one', async () => {
    const db = getDb();
    const person = (lastName: string, slackUserId?: string) =>
      db.insert(members).values({ firstName: 'Test', lastName, scanCode: newScanCode(), pageKey: newPageKey(), slackUserId }).returning();
    const [without] = await person('No Slack');
    expect(without.slackUserId).toBeNull();
    const [second] = await person('Also No Slack');
    expect(second.slackUserId).toBeNull();
    const [linked] = await person('Slack One', 'U0TESTSLACK1');
    expect(linked.slackUserId).toBe('U0TESTSLACK1');
    await expect(person('Slack Two', 'U0TESTSLACK1')).rejects.toThrow();
  });

  it('finished work can be recorded as done from Slack', async () => {
    const db = getDb();
    const [member] = await db
      .insert(members)
      .values({ firstName: 'Test', lastName: 'Via Slack', scanCode: newScanCode(), pageKey: newPageKey() })
      .returning();
    const [task] = await db.insert(tasks).values({ title: 'Slack job', audience: 'person' }).returning();
    const [handout] = await db.insert(assignments).values({ taskId: task.id, memberId: member.id, state: 'submitted', doneVia: 'slack' }).returning();
    const [sent] = await db.insert(submissions).values({ assignmentId: handout.id, memberId: member.id, via: 'slack' }).returning();
    expect(handout.doneVia).toBe('slack');
    expect(sent.via).toBe('slack');
  });
});
