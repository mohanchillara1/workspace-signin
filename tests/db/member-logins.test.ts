import { beforeAll, describe, expect, it } from 'vitest';
import { logInByName } from '@/lib/auth/member-logins';
import type { Member } from '@/lib/db/schema';
import { addMember, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-18T23:00:00Z');
const at = (firstName: string, lastName: string, ip = 'phone') => ({ firstName, lastName, ip, now: NOW });

describe('members log in with their first and last name', () => {
  const getDb = useTestDb();
  let alpha: Member;
  let gone: Member;

  beforeAll(async () => {
    const db = getDb();
    alpha = await addMember(db, { firstName: 'Test', lastName: 'Member Alpha' }, null);
    gone = await addMember(db, { firstName: 'Test', lastName: 'Member Gone' }, null);
    await setActive(db, gone.id, false, null);
    await addMember(db, { firstName: 'Test', lastName: 'Member Twin' }, null);
    await addMember(db, { firstName: 'Test', lastName: 'Member Twin' }, null);
  });

  it('opens that member page, whatever the case and spaces', async () => {
    const db = getDb();
    expect(await logInByName(db, at('Test', 'Member Alpha'))).toEqual({ ok: true, pageKey: alpha.pageKey });
    expect(await logInByName(db, at('  test ', 'member   ALPHA'))).toEqual({ ok: true, pageKey: alpha.pageKey });
  });

  it('refuses a name not on the list, a blank one, and a deactivated member', async () => {
    const db = getDb();
    expect(await logInByName(db, at('Test', 'Member Nobody'))).toEqual({ ok: false, reason: 'not_found' });
    expect(await logInByName(db, at('Test', ' '))).toEqual({ ok: false, reason: 'not_found' });
    expect(await logInByName(db, at('Test', 'Member Gone'))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('opens nothing when two people share the name', async () => {
    expect(await logInByName(getDb(), at('Test', 'Member Twin'))).toEqual({ ok: false, reason: 'two_match' });
  });

  it('a whole team logging in from one wifi is never locked out', async () => {
    const db = getDb();
    for (let i = 0; i < 40; i++) expect((await logInByName(db, at('Test', 'Member Alpha', 'team-wifi'))).ok).toBe(true);
  });

  it('twenty names not on the list from one address make it wait', async () => {
    const db = getDb();
    for (let i = 0; i < 20; i++) expect(await logInByName(db, at('Guess', `Name ${i}`, 'guesser'))).toEqual({ ok: false, reason: 'not_found' });
    expect(await logInByName(db, at('Test', 'Member Alpha', 'guesser'))).toEqual({ ok: false, reason: 'locked' });
  });
});
