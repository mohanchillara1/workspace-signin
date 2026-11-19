import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changeLog } from '@/lib/db/schema';
import { SCAN_CODE_PATTERN } from '@/lib/ids';
import {
  addMember,
  addSubteam,
  importRoster,
  listMembers,
  memberByPageKey,
  memberByScanCode,
  reissueScanCode,
  setActive,
} from '@/lib/members';
import { useTestDb } from '../setup/db';

describe('members', () => {
  const getDb = useTestDb();

  it('gives a new member a scan code and a page key that differ', async () => {
    const member = await addMember(getDb(), { firstName: ' Test ', lastName: 'Member A' }, null);
    expect(member.firstName).toBe('Test');
    expect(member.scanCode).toMatch(SCAN_CODE_PATTERN);
    expect(member.pageKey).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(member.scanCode).not.toBe(member.pageKey);
    expect((await memberByScanCode(getDb(), member.scanCode))?.id).toBe(member.id);
    expect((await memberByPageKey(getDb(), member.pageKey))?.id).toBe(member.id);
  });

  it('does not find a deactivated member by code or by key', async () => {
    const db = getDb();
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, null);
    await setActive(db, member.id, false, null);
    expect(await memberByScanCode(db, member.scanCode)).toBeNull();
    expect(await memberByPageKey(db, member.pageKey)).toBeNull();
    await setActive(db, member.id, true, null);
    expect((await memberByScanCode(db, member.scanCode))?.id).toBe(member.id);
  });

  it('makes the old code unknown when a new one is issued, and logs who did it', async () => {
    const db = getDb();
    const lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    const member = await addMember(db, { firstName: 'Test', lastName: 'Member C' }, lead.id);
    const fresh = await reissueScanCode(db, member.id, lead.id);
    expect(fresh).not.toBe(member.scanCode);
    expect(await memberByScanCode(db, member.scanCode)).toBeNull();
    expect((await memberByScanCode(db, fresh))?.id).toBe(member.id);
    const logged = await db.select().from(changeLog).where(eq(changeLog.action, 'member.new_code'));
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBe(lead.id);
    expect(JSON.stringify(logged[0].detail)).not.toContain(fresh);
  });

  it('refuses an empty name and a name that is too long', async () => {
    await expect(addMember(getDb(), { firstName: '  ', lastName: 'X' }, null)).rejects.toThrow();
    await expect(addMember(getDb(), { firstName: 'T'.repeat(61), lastName: 'X' }, null)).rejects.toThrow();
  });

  it('adds a pasted roster, makes subteams it has not seen, and reports bad lines', async () => {
    const db = getDb();
    await addSubteam(db, 'Build');
    const result = await importRoster(db, 'Test Member D, Build\n\nTest Member E\n,bad\nTest Member F, Outreach', null);
    expect(result.added).toBe(3);
    expect(result.skipped).toEqual([',bad']);
    const all = await listMembers(db);
    const d = all.find((m) => m.lastName === 'Member D');
    const f = all.find((m) => m.lastName === 'Member F');
    expect(d?.subteamName).toBe('Build');
    expect(f?.subteamName).toBe('Outreach');
    expect(all.find((m) => m.lastName === 'Member E')?.subteamName).toBeNull();
  });
});
