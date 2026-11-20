import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite, checkLogin, createInvite, leadByLoginName, leadForSession } from '@/lib/auth/leads';
import { leadLogins, type Member } from '@/lib/db/schema';
import { addMember, setActive, updateMember } from '@/lib/members';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-18T23:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const GOOD = 'correct horse 42';

describe('lead logins', () => {
  const getDb = useTestDb();
  let captain: Member;
  let lead: Member;
  let plain: Member;

  beforeAll(async () => {
    const db = getDb();
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    plain = await addMember(db, { firstName: 'Test', lastName: 'Member', role: 'member' }, null);
  });

  it('lets only a captain invite, and only a lead or captain be invited', async () => {
    const db = getDb();
    await expect(createInvite(db, { memberId: lead.id, actorId: lead.id, now: NOW })).rejects.toThrow();
    await expect(createInvite(db, { memberId: plain.id, actorId: captain.id, now: NOW })).rejects.toThrow();
    await expect(createInvite(db, { memberId: lead.id, actorId: null, now: NOW })).rejects.toThrow();
    const token = await createInvite(db, { memberId: lead.id, actorId: captain.id, now: NOW });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('refuses a short password and a bad login name, then works once', async () => {
    const db = getDb();
    const token = await createInvite(db, { memberId: lead.id, actorId: captain.id, now: NOW });
    expect(await acceptInvite(db, { token, loginName: 'testlead', password: 'four', now: NOW })).toEqual({ ok: false, reason: 'weak_password' });
    expect(await acceptInvite(db, { token, loginName: 'a b', password: GOOD, now: NOW })).toEqual({ ok: false, reason: 'bad_name' });
    expect(await acceptInvite(db, { token: 'not-a-token', loginName: 'testlead', password: GOOD, now: NOW })).toEqual({ ok: false, reason: 'bad_link' });
    expect((await acceptInvite(db, { token, loginName: ' TestLead ', password: GOOD, now: NOW })).ok).toBe(true);
    expect(await acceptInvite(db, { token, loginName: 'testlead', password: GOOD, now: NOW })).toEqual({ ok: false, reason: 'bad_link' });
    const [login] = await db.select().from(leadLogins).where(eq(leadLogins.memberId, lead.id));
    expect(login.loginName).toBe('testlead');
    expect(login.passwordHash).not.toContain(GOOD);
    expect(login.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('refuses an invite after 7 days', async () => {
    const db = getDb();
    const token = await createInvite(db, { memberId: captain.id, actorId: null, now: NOW, bootstrap: true });
    const late = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);
    expect(await acceptInvite(db, { token, loginName: 'testcaptain', password: GOOD, now: late })).toEqual({ ok: false, reason: 'bad_link' });
    expect((await acceptInvite(db, { token, loginName: 'testcaptain', password: GOOD, now: later(5) })).ok).toBe(true);
  });

  it('will not give a second lead a login name that is taken', async () => {
    const db = getDb();
    const second = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    const token = await createInvite(db, { memberId: second.id, actorId: captain.id, now: NOW });
    expect(await acceptInvite(db, { token, loginName: 'testlead', password: GOOD, now: NOW })).toEqual({ ok: false, reason: 'name_taken' });
    expect((await acceptInvite(db, { token, loginName: 'testlead2', password: GOOD, now: NOW })).ok).toBe(true);
  });

  it('logs a lead in, and gives the same answer for a wrong password and an unknown name', async () => {
    const db = getDb();
    const good = await checkLogin(db, { loginName: 'TestLead', password: GOOD, ip: '10.0.0.1', now: later(20) });
    expect(good).toMatchObject({ ok: true, memberId: lead.id });
    expect(await checkLogin(db, { loginName: 'testlead', password: 'wrong password', ip: '10.0.0.2', now: later(20) })).toEqual({ ok: false, reason: 'wrong' });
    expect(await checkLogin(db, { loginName: 'nobody', password: GOOD, ip: '10.0.0.3', now: later(20) })).toEqual({ ok: false, reason: 'wrong' });
  });

  it('locks a login name after 5 wrong tries, even for the right password', async () => {
    const db = getDb();
    const at = later(60);
    for (let i = 0; i < 5; i++) {
      expect(await checkLogin(db, { loginName: 'testlead2', password: 'wrong password', ip: `10.1.0.${i}`, now: at })).toEqual({ ok: false, reason: 'wrong' });
    }
    expect(await checkLogin(db, { loginName: 'testlead2', password: GOOD, ip: '10.1.0.9', now: at })).toEqual({ ok: false, reason: 'locked' });
    expect((await checkLogin(db, { loginName: 'testlead2', password: GOOD, ip: '10.1.0.9', now: later(80) })).ok).toBe(true);
  });

  it('locks an address after 20 wrong tries across names', async () => {
    const db = getDb();
    const at = later(120);
    for (let i = 0; i < 20; i++) {
      await checkLogin(db, { loginName: `guess${i}`, password: 'wrong password', ip: '10.2.0.1', now: at });
    }
    expect(await checkLogin(db, { loginName: 'testlead', password: GOOD, ip: '10.2.0.1', now: at })).toEqual({ ok: false, reason: 'locked' });
    expect((await checkLogin(db, { loginName: 'testlead', password: GOOD, ip: '10.2.0.2', now: at })).ok).toBe(true);
  });

  it('ends a session when the lead is deactivated, demoted, or sent a new invite', async () => {
    const db = getDb();
    const fresh = async (minutes: number) => {
      const login = await checkLogin(db, { loginName: 'testlead', password: GOOD, ip: '10.3.0.1', now: later(minutes) });
      if (!login.ok) throw new Error('expected a login');
      return { memberId: login.memberId, version: login.version, sid: `sid-${minutes}` };
    };
    let session = await fresh(200);
    expect((await leadForSession(db, session))?.id).toBe(lead.id);

    await setActive(db, lead.id, false, captain.id);
    expect(await leadForSession(db, session)).toBeNull();
    expect((await checkLogin(db, { loginName: 'testlead', password: GOOD, ip: '10.3.0.2', now: later(200) })).ok).toBe(false);
    await setActive(db, lead.id, true, captain.id);

    session = await fresh(201);
    await updateMember(db, lead.id, { role: 'member' }, captain.id);
    expect(await leadForSession(db, session)).toBeNull();
    await updateMember(db, lead.id, { role: 'lead' }, captain.id);

    session = await fresh(202);
    await createInvite(db, { memberId: lead.id, actorId: captain.id, now: later(203) });
    expect(await leadForSession(db, session)).toBeNull();
    // The old password stops working the moment a new invite goes out.
    expect((await checkLogin(db, { loginName: 'testlead', password: GOOD, ip: '10.3.0.3', now: later(204) })).ok).toBe(false);
  });

  it('finds a lead by login name for the invite script, and nobody for an unknown name or someone who is no longer a lead', async () => {
    const db = getDb();
    const other = await addMember(db, { firstName: 'Test', lastName: 'Finder', role: 'lead' }, null);
    const token = await createInvite(db, { memberId: other.id, actorId: captain.id, now: later(300) });
    expect((await acceptInvite(db, { token, loginName: 'finder', password: GOOD, now: later(300) })).ok).toBe(true);
    expect((await leadByLoginName(db, ' Finder '))?.id).toBe(other.id);
    expect(await leadByLoginName(db, 'nobody-here')).toBeNull();
    await updateMember(db, other.id, { role: 'member' }, captain.id);
    expect(await leadByLoginName(db, 'finder')).toBeNull();
  });
});
