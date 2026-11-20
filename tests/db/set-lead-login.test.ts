import { describe, expect, it } from 'vitest';
import { checkLogin, setLeadLogin } from '@/lib/auth/leads';
import { members } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { eq } from 'drizzle-orm';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-20T03:00:00Z');

describe('setting an admin login from the command line', () => {
  const getDb = useTestDb();

  it('makes a member a captain with a login that works', async () => {
    const db = getDb();
    const m = await addMember(db, { firstName: 'Set', lastName: 'Captain' }, null);
    expect(await setLeadLogin(db, { memberId: m.id, role: 'captain', loginName: 'setcap', password: 'pass5', now: NOW })).toMatchObject({ ok: true });
    const [after] = await db.select().from(members).where(eq(members.id, m.id));
    expect(after.role).toBe('captain');
    expect((await checkLogin(db, { loginName: 'setcap', password: 'pass5', ip: 'x', now: NOW })).ok).toBe(true);
  });

  it('replaces an earlier password', async () => {
    const db = getDb();
    const m = await addMember(db, { firstName: 'Set', lastName: 'Lead' }, null);
    await setLeadLogin(db, { memberId: m.id, role: 'lead', loginName: 'setlead', password: 'first1', now: NOW });
    await setLeadLogin(db, { memberId: m.id, role: 'lead', loginName: 'setlead', password: 'second', now: NOW });
    expect((await checkLogin(db, { loginName: 'setlead', password: 'first1', ip: 'y', now: NOW })).ok).toBe(false);
    expect((await checkLogin(db, { loginName: 'setlead', password: 'second', ip: 'y', now: NOW })).ok).toBe(true);
  });

  it('refuses a short password and a turned-off member', async () => {
    const db = getDb();
    const m = await addMember(db, { firstName: 'Set', lastName: 'Short' }, null);
    expect(await setLeadLogin(db, { memberId: m.id, role: 'lead', loginName: 'setshort', password: 'abcd', now: NOW })).toEqual({ ok: false, reason: 'weak_password' });
    await setActive(db, m.id, false, null);
    expect(await setLeadLogin(db, { memberId: m.id, role: 'lead', loginName: 'setshort', password: 'abcde', now: NOW })).toEqual({ ok: false, reason: 'bad_link' });
  });
});
