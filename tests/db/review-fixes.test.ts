// Faults found by the phase 1 review in logins, permissions and the roster.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { acceptInvite, checkLogin, createInvite, endSession, leadForSession } from '@/lib/auth/leads';
import { members, subteams, type Member } from '@/lib/db/schema';
import { UserError } from '@/lib/errors';
import { addMember, addSubteam, assertMayManage, importRoster, listMembers, removeSubteam, setActive, updateMember } from '@/lib/members';
import { createTask } from '@/lib/tasks';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-19T07:00:00Z');
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const GOOD = 'correct horse 42';

describe('review fixes: logins and permissions', () => {
  const getDb = useTestDb();
  let captain: Member;
  let captain2: Member;
  let lead: Member;
  let lead2: Member;
  let plain: Member;

  beforeAll(async () => {
    const db = getDb();
    captain = await addMember(db, { firstName: 'Test', lastName: 'Captain', role: 'captain' }, null);
    captain2 = await addMember(db, { firstName: 'Test', lastName: 'Captain Two', role: 'captain' }, null);
    lead = await addMember(db, { firstName: 'Test', lastName: 'Lead', role: 'lead' }, null);
    lead2 = await addMember(db, { firstName: 'Test', lastName: 'Lead Two', role: 'lead' }, null);
    plain = await addMember(db, { firstName: 'Test', lastName: 'Member' }, null);
    for (const [who, name] of [[captain, 'cap1'], [lead, 'lead1'], [lead2, 'lead2']] as const) {
      const token = await createInvite(db, { memberId: who.id, actorId: null, now: NOW, bootstrap: true });
      expect((await acceptInvite(db, { token, loginName: name, password: GOOD, now: NOW })).ok).toBe(true);
    }
  });

  const login = async (name: string, at: Date, ip = '10.9.0.1') => {
    const result = await checkLogin(getDb(), { loginName: name, password: GOOD, ip, now: at });
    if (!result.ok) throw new Error(`expected ${name} to log in, got ${result.reason}`);
    return { memberId: result.memberId, version: result.version, sid: `sid-${name}-${at.getTime()}-${ip}` };
  };

  it('logging out ends that session and leaves the lead\'s other sessions alone', async () => {
    const db = getDb();
    const laptop = await login('lead1', later(1), '10.9.0.1');
    const ipad = await login('lead1', later(1), '10.9.0.2');
    expect((await leadForSession(db, laptop))?.id).toBe(lead.id);
    await endSession(db, ipad.sid);
    expect(await leadForSession(db, ipad)).toBeNull();
    expect((await leadForSession(db, laptop))?.id).toBe(lead.id);
    // A cookie with no session id (an old one) is not accepted.
    expect(await leadForSession(db, { memberId: laptop.memberId, version: laptop.version })).toBeNull();
  });

  it('a session that ended with deactivation or demotion stays ended after the lead is restored', async () => {
    const db = getDb();
    const session = await login('lead2', later(2));
    await setActive(db, lead2.id, false, captain.id);
    await setActive(db, lead2.id, true, captain.id);
    expect(await leadForSession(db, session)).toBeNull();
    const again = await login('lead2', later(3));
    await updateMember(db, lead2.id, { role: 'member' }, captain.id);
    await updateMember(db, lead2.id, { role: 'lead' }, captain.id);
    expect(await leadForSession(db, again)).toBeNull();
    expect((await leadForSession(db, await login('lead2', later(4))))?.id).toBe(lead2.id);
  });

  it('thirty wrong guesses sent at once do not all get checked, and the lock then holds', async () => {
    const db = getDb();
    const at = later(60);
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => checkLogin(db, { loginName: 'lead1', password: `guess number ${i}`, ip: `10.8.0.${i}`, now: at })),
    );
    expect(results.filter((r) => !r.ok && r.reason === 'wrong').length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => !r.ok && r.reason === 'locked').length).toBeGreaterThanOrEqual(25);
    expect(await checkLogin(db, { loginName: 'lead1', password: GOOD, ip: '10.8.1.1', now: at })).toEqual({ ok: false, reason: 'locked' });
  });

  it('logging in many times with the right password never locks the name', async () => {
    const db = getDb();
    const at = later(120);
    for (let i = 0; i < 12; i++) {
      expect((await checkLogin(db, { loginName: 'cap1', password: GOOD, ip: '10.7.0.1', now: at })).ok).toBe(true);
    }
  });

  it('one invite accepted four times at once works once', async () => {
    const db = getDb();
    const fresh = await addMember(db, { firstName: 'Race', lastName: 'Lead', role: 'lead' }, null);
    const token = await createInvite(db, { memberId: fresh.id, actorId: captain.id, now: later(200) });
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) => acceptInvite(db, { token, loginName: `racer${i}`, password: `${GOOD} ${i}`, now: later(201) })),
    );
    const won = results.map((r, i) => ({ r, i })).filter((x) => x.r.ok);
    expect(won).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'bad_link')).toHaveLength(3);
    const winner = won[0].i;
    expect((await checkLogin(db, { loginName: `racer${winner}`, password: `${GOOD} ${winner}`, ip: '10.6.0.1', now: later(202) })).ok).toBe(true);
  });

  it('a lead who is not a captain cannot change a lead or a captain; a captain cannot switch themselves off', async () => {
    const db = getDb();
    const refused = async (actor: Member, target: Member, what: 'deactivate' | 'reactivate' | 'new-code' | 'new-link' | 'edit' | 'role') => {
      try {
        await assertMayManage(db, actor.id, target.id, what);
        return null;
      } catch (error) {
        return error instanceof UserError ? error.key : 'other';
      }
    };
    expect(await refused(lead, captain, 'deactivate')).toBe('leadsAreCaptainOnly');
    expect(await refused(lead, captain, 'new-code')).toBe('leadsAreCaptainOnly');
    expect(await refused(lead, lead2, 'new-link')).toBe('leadsAreCaptainOnly');
    expect(await refused(lead, plain, 'role')).toBe('leadsAreCaptainOnly');
    expect(await refused(lead, plain, 'deactivate')).toBeNull();
    expect(await refused(lead, plain, 'edit')).toBeNull();
    expect(await refused(lead, lead, 'new-code')).toBeNull();
    expect(await refused(captain, captain2, 'deactivate')).toBeNull();
    expect(await refused(captain, lead, 'role')).toBeNull();
    expect(await refused(captain, captain, 'deactivate')).toBe('notYourself');
    expect(await refused(captain, captain, 'role')).toBe('notYourself');
    expect(await refused(plain, plain, 'edit')).toBe('leadsAreCaptainOnly');
  });
});

describe('review fixes: the roster', () => {
  const getDb = useTestDb();

  it('reads a pasted CSV with a header row, quotes and three columns', async () => {
    const db = getDb();
    await addSubteam(db, 'Build');
    const csv = 'Name,Subteam\r\n"Test Member Q",Build\r\nTest,Member R,Build\r\n"Test Member S","Programming"\r\nTest Member T\r\n';
    const result = await importRoster(db, csv, null);
    expect(result.added).toBe(4);
    expect(result.skipped).toEqual([]);
    const all = await listMembers(db);
    const named = (last: string) => {
      const found = all.find((m) => m.lastName === last);
      return { firstName: found?.firstName, subteams: found?.subteams.map((s) => s.name) };
    };
    expect(named('Member Q')).toEqual({ firstName: 'Test', subteams: ['Build'] });
    expect(named('Member R')).toEqual({ firstName: 'Test', subteams: ['Build'] });
    expect(named('Member S')).toEqual({ firstName: 'Test', subteams: ['Programming'] });
    expect(named('Member T')).toEqual({ firstName: 'Test', subteams: [] });
    const teams = (await db.select().from(subteams)).map((s) => s.name).sort();
    expect(teams).toEqual(['Build', 'Programming']);
    expect(all.some((m) => m.firstName.toLowerCase() === 'name')).toBe(false);
  });

  it('does not add someone who is already on the roster', async () => {
    const db = getDb();
    const again = await importRoster(db, 'test member q, Build\nTest Member U, Build', null);
    expect(again.added).toBe(1);
    expect(again.already).toEqual(['test member q']);
    const all = await db.select().from(members);
    expect(all.filter((m) => m.lastName.toLowerCase() === 'member q')).toHaveLength(1);
  });

  it('removes a subteam only when nothing uses it', async () => {
    const db = getDb();
    const empty = await addSubteam(db, 'Typo Team');
    await removeSubteam(db, empty.id, null);
    expect((await db.select().from(subteams).where(eq(subteams.id, empty.id))).length).toBe(0);
    const used = await addSubteam(db, 'Build');
    await expect(removeSubteam(db, used.id, null)).rejects.toThrow(UserError);
    const withTask = await addSubteam(db, 'Has A Task');
    await createTask(db, { title: 'For that team', audience: 'subteam', subteamId: withTask.id }, null);
    await expect(removeSubteam(db, withTask.id, null)).rejects.toThrow(UserError);
  });
});
