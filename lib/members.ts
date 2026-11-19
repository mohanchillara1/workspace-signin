import { and, asc, eq, sql } from 'drizzle-orm';
import { copy } from './copy';
import type { Db } from './db/client';
import { leadLogins, members, subteams, type Member, type Subteam } from './db/schema';
import { UserError } from './errors';
import { newPageKey, newScanCode, SCAN_CODE_PATTERN } from './ids';
import { logChange } from './log';

export type Role = Member['role'];
export type NewMember = { firstName: string; lastName?: string; subteamId?: string | null; role?: Role };
export type MemberListRow = Member & { subteamName: string | null; hasLogin: boolean };

const NAME_MAX = 60;
const PAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function cleanName(text: string | undefined, emptyMessage: string | null): string {
  const name = (text ?? '').replace(/\s+/g, ' ').trim();
  if (emptyMessage && !name) throw new UserError(emptyMessage);
  if (name.length > NAME_MAX) throw new UserError(copy.errors.nameLong(NAME_MAX));
  return name;
}

export async function addMember(db: Db, input: NewMember, actorId: string | null): Promise<Member> {
  const [member] = await db
    .insert(members)
    .values({
      firstName: cleanName(input.firstName, copy.errors.firstNameEmpty),
      lastName: cleanName(input.lastName, null),
      subteamId: input.subteamId ?? null,
      role: input.role ?? 'member',
      scanCode: newScanCode(),
      pageKey: newPageKey(),
    })
    .returning();
  await logChange(db, { actorId, action: 'member.add', entity: 'member', entityId: member.id });
  return member;
}

export async function updateMember(
  db: Db,
  id: string,
  patch: { firstName?: string; lastName?: string; subteamId?: string | null; role?: Role },
  actorId: string | null,
): Promise<void> {
  const set: Partial<typeof members.$inferInsert> = {};
  if (patch.firstName !== undefined) set.firstName = cleanName(patch.firstName, copy.errors.firstNameEmpty);
  if (patch.lastName !== undefined) set.lastName = cleanName(patch.lastName, null);
  if (patch.subteamId !== undefined) set.subteamId = patch.subteamId;
  if (patch.role !== undefined) set.role = patch.role;
  if (Object.keys(set).length === 0) return;
  await db.update(members).set(set).where(eq(members.id, id));
  await logChange(db, {
    actorId,
    action: 'member.edit',
    entity: 'member',
    entityId: id,
    detail: { fields: Object.keys(set) },
  });
}

export async function setActive(db: Db, id: string, active: boolean, actorId: string | null): Promise<void> {
  await db
    .update(members)
    .set({ active, deactivatedAt: active ? null : new Date() })
    .where(eq(members.id, id));
  await logChange(db, {
    actorId,
    action: active ? 'member.reactivate' : 'member.deactivate',
    entity: 'member',
    entityId: id,
  });
}

/** Issues a new QR code. The old one stops working at once. */
export async function reissueScanCode(db: Db, id: string, actorId: string | null): Promise<string> {
  const scanCode = newScanCode();
  await db.update(members).set({ scanCode }).where(eq(members.id, id));
  await logChange(db, { actorId, action: 'member.new_code', entity: 'member', entityId: id });
  return scanCode;
}

/** Issues a new private page link. The old link stops working at once. */
export async function reissuePageKey(db: Db, id: string, actorId: string | null): Promise<string> {
  const pageKey = newPageKey();
  await db.update(members).set({ pageKey }).where(eq(members.id, id));
  await logChange(db, { actorId, action: 'member.new_link', entity: 'member', entityId: id });
  return pageKey;
}

/** The active member a scanned code belongs to, or null for anything else. */
export async function memberByScanCode(db: Db, code: unknown): Promise<Member | null> {
  if (typeof code !== 'string' || !SCAN_CODE_PATTERN.test(code)) return null;
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.scanCode, code), eq(members.active, true)));
  return member ?? null;
}

export async function memberByPageKey(db: Db, key: unknown): Promise<Member | null> {
  if (typeof key !== 'string' || !PAGE_KEY_PATTERN.test(key)) return null;
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.pageKey, key), eq(members.active, true)));
  return member ?? null;
}

export async function memberById(db: Db, id: string): Promise<Member | null> {
  const [member] = await db.select().from(members).where(eq(members.id, id));
  return member ?? null;
}

export async function listMembers(db: Db): Promise<MemberListRow[]> {
  const rows = await db
    .select({ member: members, subteamName: subteams.name, loginName: leadLogins.loginName })
    .from(members)
    .leftJoin(subteams, eq(members.subteamId, subteams.id))
    .leftJoin(leadLogins, eq(leadLogins.memberId, members.id))
    .orderBy(asc(members.firstName), asc(members.lastName));
  return rows.map((r) => ({ ...r.member, subteamName: r.subteamName, hasLogin: r.loginName !== null }));
}

export async function addSubteam(db: Db, name: string): Promise<Subteam> {
  const clean = cleanName(name, copy.errors.subteamEmpty);
  const [existing] = await db
    .select()
    .from(subteams)
    .where(sql`lower(${subteams.name}) = lower(${clean})`);
  if (existing) return existing;
  const [made] = await db.insert(subteams).values({ name: clean }).returning();
  return made;
}

export async function listSubteams(db: Db): Promise<Subteam[]> {
  return db.select().from(subteams).orderBy(asc(subteams.name));
}

/**
 * Adds members from pasted text, one per line: "First Last" or
 * "First Last, Subteam". A subteam that does not exist yet is made.
 */
export async function importRoster(
  db: Db,
  text: string,
  actorId: string | null,
): Promise<{ added: number; skipped: string[] }> {
  let added = 0;
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    const namePart = (comma === -1 ? line : line.slice(0, comma)).replace(/\s+/g, ' ').trim();
    const subteamPart = comma === -1 ? '' : line.slice(comma + 1).trim();
    const space = namePart.indexOf(' ');
    const firstName = space === -1 ? namePart : namePart.slice(0, space);
    const lastName = space === -1 ? '' : namePart.slice(space + 1);
    if (!firstName || firstName.length > NAME_MAX || lastName.length > NAME_MAX || subteamPart.length > NAME_MAX) {
      skipped.push(line);
      continue;
    }
    const subteam = subteamPart ? await addSubteam(db, subteamPart) : null;
    await addMember(db, { firstName, lastName, subteamId: subteam?.id ?? null }, actorId);
    added++;
  }
  return { added, skipped };
}
