import { and, asc, eq, or } from 'drizzle-orm';
import type { Db } from './db/client';
import { memberSubteams, members, subteams } from './db/schema';

export type SubteamRef = { id: string; name: string };

/**
 * What one person is in. `subteams` are the ones they were put in, in name
 * order. `reach` adds the subteam each of those is part of: a task for any id
 * in `reach` is theirs too.
 */
export type Membership = { subteams: SubteamRef[]; reach: Set<string> };

/** Everyone's subteams, by member id. Someone in none has no entry. */
export async function memberships(db: Db, memberId?: string): Promise<Map<string, Membership>> {
  const rows = await db
    .select({ memberId: memberSubteams.memberId, id: subteams.id, name: subteams.name, parentId: subteams.parentId })
    .from(memberSubteams)
    .innerJoin(subteams, eq(memberSubteams.subteamId, subteams.id))
    .where(memberId ? eq(memberSubteams.memberId, memberId) : undefined)
    .orderBy(asc(subteams.name));
  const all = new Map<string, Membership>();
  for (const row of rows) {
    const mine = all.get(row.memberId) ?? { subteams: [], reach: new Set<string>() };
    mine.subteams.push({ id: row.id, name: row.name });
    mine.reach.add(row.id);
    if (row.parentId) mine.reach.add(row.parentId);
    all.set(row.memberId, mine);
  }
  return all;
}

export async function membershipOf(db: Db, memberId: string): Promise<Membership> {
  return (await memberships(db, memberId)).get(memberId) ?? { subteams: [], reach: new Set() };
}

/** A person's subteams as one line of words ("Assembly, CAD"), or null for none. */
export function subteamLine(membership: Membership | undefined): string | null {
  return membership?.subteams.length ? membership.subteams.map((s) => s.name).join(', ') : null;
}

/**
 * The active members a task for this subteam goes to: everyone in it, and
 * everyone in a subteam that is part of it. Each person once.
 */
export async function peopleReached(db: Db, subteamId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: members.id })
    .from(memberSubteams)
    .innerJoin(subteams, eq(memberSubteams.subteamId, subteams.id))
    .innerJoin(members, eq(memberSubteams.memberId, members.id))
    .where(and(eq(members.active, true), or(eq(subteams.id, subteamId), eq(subteams.parentId, subteamId))));
  return rows.map((row) => row.id);
}
