import { beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite, checkLogin, createInvite } from '@/lib/auth/leads';
import { checkMemberLogin, setMemberLogin } from '@/lib/auth/member-logins';
import type { Member } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-18T23:00:00Z');

describe('member logins', () => {
  const getDb = useTestDb();
  let captain: Member;
  let member: Member;
  let other: Member;

  beforeAll(async () => {
    const db = getDb();
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    member = await addMember(db, { firstName: 'Test', lastName: 'Member A' }, captain.id);
    other = await addMember(db, { firstName: 'Test', lastName: 'Member B' }, captain.id);
    const token = await createInvite(db, { memberId: captain.id, actorId: null, now: NOW, bootstrap: true });
    await acceptInvite(db, { token, loginName: 'capt', password: 'captain pass 1', now: NOW });
  });

  it('opens only the member page, never the dashboard', async () => {
    const db = getDb();
    await setMemberLogin(db, { memberId: member.id, loginName: 'MemberA', password: 'member pass 1', actorId: captain.id, now: NOW });
    expect(await checkMemberLogin(db, { loginName: 'membera', password: 'member pass 1' })).toBe(member.pageKey);
    expect(await checkMemberLogin(db, { loginName: 'membera', password: 'wrong pass 11' })).toBeNull();
    const asLead = await checkLogin(db, { loginName: 'membera', password: 'member pass 1', ip: 'x', now: NOW });
    expect(asLead.ok).toBe(false);
  });

  it('refuses short passwords, bad names and names already taken', async () => {
    const db = getDb();
    const base = { memberId: other.id, actorId: captain.id, now: NOW };
    await expect(setMemberLogin(db, { ...base, loginName: 'memberb', password: 'short' })).rejects.toThrow();
    await expect(setMemberLogin(db, { ...base, loginName: 'no spaces', password: 'long enough 1' })).rejects.toThrow();
    await expect(setMemberLogin(db, { ...base, loginName: 'membera', password: 'long enough 1' })).rejects.toThrow();
    await expect(setMemberLogin(db, { ...base, loginName: 'capt', password: 'long enough 1' })).rejects.toThrow();
  });

  it('stops working when the member is deactivated', async () => {
    const db = getDb();
    await setActive(db, member.id, false, captain.id);
    expect(await checkMemberLogin(db, { loginName: 'membera', password: 'member pass 1' })).toBeNull();
  });
});
