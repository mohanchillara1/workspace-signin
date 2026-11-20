import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createInvite, inviteMember } from '@/lib/auth/leads';
import { changeLog, members } from '@/lib/db/schema';
import { addMember, captainNamed, setActive } from '@/lib/members';
import { useTestDb } from '../setup/db';

const NOW = new Date('2026-11-20T04:00:00Z');

describe('the first captain, named on the command line', () => {
  const getDb = useTestDb();

  it('uses the person already on the roster and makes them a captain, without adding a second person', async () => {
    const db = getDb();
    const onRoster = await addMember(db, { firstName: 'Roster', lastName: 'Person A' }, null);
    const result = await captainNamed(db, { firstName: ' roster ', lastName: 'PERSON  a' });
    expect(result).toEqual({ ok: true, memberId: onRoster.id, added: false });
    const same = await db.select().from(members).where(eq(members.lastName, 'Person A'));
    expect(same).toHaveLength(1);
    expect(same[0].role).toBe('captain');
    // Their page link and QR code are the ones they already had.
    expect(same[0]).toMatchObject({ pageKey: onRoster.pageKey, scanCode: onRoster.scanCode });
    const logged = await db.select().from(changeLog).where(eq(changeLog.entityId, onRoster.id));
    expect(logged.map((l) => l.action)).toContain('member.edit');
    // And an invite made for them opens.
    const token = await createInvite(db, { memberId: onRoster.id, actorId: null, now: NOW, bootstrap: true });
    expect((await inviteMember(db, token, NOW))?.id).toBe(onRoster.id);
  });

  it('adds a new captain when nobody on the roster has the name', async () => {
    const db = getDb();
    const result = await captainNamed(db, { firstName: 'Brand', lastName: 'New' });
    expect(result).toMatchObject({ ok: true, added: true });
    const rows = await db.select().from(members).where(eq(members.lastName, 'New'));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('captain');
  });

  it('leaves someone who is already a captain as they are', async () => {
    const db = getDb();
    const captain = await addMember(db, { firstName: 'Roster', lastName: 'Person B', role: 'captain' }, null);
    expect(await captainNamed(db, { firstName: 'Roster', lastName: 'Person B' })).toEqual({ ok: true, memberId: captain.id, added: false });
    const logged = await db.select().from(changeLog).where(eq(changeLog.entityId, captain.id));
    expect(logged.map((l) => l.action)).toEqual(['member.add']);
  });

  it('refuses a name two people share, and a person who is switched off, and changes nothing', async () => {
    const db = getDb();
    await addMember(db, { firstName: 'Roster', lastName: 'Twin' }, null);
    await addMember(db, { firstName: 'roster', lastName: 'twin' }, null);
    expect(await captainNamed(db, { firstName: 'Roster', lastName: 'Twin' })).toEqual({ ok: false, reason: 'two_match' });
    const off = await addMember(db, { firstName: 'Roster', lastName: 'Person C' }, null);
    await setActive(db, off.id, false, null);
    expect(await captainNamed(db, { firstName: 'Roster', lastName: 'Person C' })).toEqual({ ok: false, reason: 'turned_off' });
    const all = await db.select().from(members);
    expect(all.filter((m) => m.lastName.toLowerCase() === 'twin' || m.lastName === 'Person C').map((m) => m.role)).toEqual(['member', 'member', 'member']);
  });
});
