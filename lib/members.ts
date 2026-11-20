import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { parseCsvLine } from './csv';
import type { Db } from './db/client';
import { leadLogins, memberSubteams, members, subteams, tasks, type Member, type Subteam } from './db/schema';
import { UserError, type ErrorKey } from './errors';
import { isUuid, newPageKey, newScanCode, SCAN_CODE_PATTERN } from './ids';
import { logChange } from './log';
import { memberships, type SubteamRef } from './subteams';
import { syncMember } from './tasks';

export type Role = Member['role'];
export type NewMember = { firstName: string; lastName?: string; subteamIds?: string[]; role?: Role };
/** `subteams` are the ones the person is in, in name order. */
export type MemberListRow = Member & { subteams: SubteamRef[]; hasLogin: boolean };

const NAME_MAX = 60;
/**
 * A member id as Slack shows them: a U or a W, then capital letters and
 * digits (the docs' examples are U123ABC456 and W012A3CDE). Slack's pages give
 * no formal rule, so the length range is a generous reading of the examples.
 */
export const SLACK_ID_PATTERN = /^[UW][A-Z0-9]{8,20}$/;
const PAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function cleanName(text: string | undefined, emptyError: ErrorKey | null): string {
  const name = (text ?? '').replace(/\s+/g, ' ').trim();
  if (emptyError && !name) throw new UserError(emptyError);
  if (name.length > NAME_MAX) throw new UserError('nameLong');
  return name;
}

/** Ends every session a lead has, wherever they are logged in. */
async function endAllSessions(db: Db, memberId: string): Promise<void> {
  await db
    .update(leadLogins)
    .set({ version: sql`${leadLogins.version} + 1`, updatedAt: new Date() })
    .where(eq(leadLogins.memberId, memberId));
}

/**
 * Makes a person's subteams exactly these. An id that is no subteam is left
 * out. Says whether anything changed.
 */
async function writeSubteams(db: Db, memberId: string, wanted: string[]): Promise<boolean> {
  const asked = [...new Set(wanted)].filter(isUuid);
  return db.transaction(async (tx) => {
    const real = asked.length
      ? (await tx.select({ id: subteams.id }).from(subteams).where(inArray(subteams.id, asked))).map((s) => s.id)
      : [];
    const have = (
      await tx.select({ id: memberSubteams.subteamId }).from(memberSubteams).where(eq(memberSubteams.memberId, memberId))
    ).map((row) => row.id);
    const add = real.filter((id) => !have.includes(id));
    const drop = have.filter((id) => !real.includes(id));
    if (drop.length) {
      await tx.delete(memberSubteams).where(and(eq(memberSubteams.memberId, memberId), inArray(memberSubteams.subteamId, drop)));
    }
    if (add.length) await tx.insert(memberSubteams).values(add.map((subteamId) => ({ memberId, subteamId })));
    return add.length + drop.length > 0;
  });
}

export async function addMember(db: Db, input: NewMember, actorId: string | null): Promise<Member> {
  const [member] = await db
    .insert(members)
    .values({
      firstName: cleanName(input.firstName, 'firstNameEmpty'),
      lastName: cleanName(input.lastName, null),
      role: input.role ?? 'member',
      scanCode: newScanCode(),
      pageKey: newPageKey(),
    })
    .returning();
  await logChange(db, { actorId, action: 'member.add', entity: 'member', entityId: member.id });
  if (await writeSubteams(db, member.id, input.subteamIds ?? [])) await syncMember(db, member.id);
  return member;
}

/** `subteamIds` is the whole list: the person ends up in exactly these. */
export async function updateMember(
  db: Db,
  id: string,
  patch: { firstName?: string; lastName?: string; subteamIds?: string[]; role?: Role },
  actorId: string | null,
): Promise<void> {
  const [before] = await db.select().from(members).where(eq(members.id, id));
  if (!before) return;
  const set: Partial<typeof members.$inferInsert> = {};
  if (patch.firstName !== undefined) set.firstName = cleanName(patch.firstName, 'firstNameEmpty');
  if (patch.lastName !== undefined) set.lastName = cleanName(patch.lastName, null);
  if (patch.role !== undefined) set.role = patch.role;
  const moved = patch.subteamIds !== undefined && (await writeSubteams(db, id, patch.subteamIds));
  if (Object.keys(set).length === 0 && !moved) return;
  if (Object.keys(set).length) await db.update(members).set(set).where(eq(members.id, id));
  await logChange(db, {
    actorId,
    action: 'member.edit',
    entity: 'member',
    entityId: id,
    detail: { fields: [...Object.keys(set), ...(moved ? ['subteams'] : [])] },
  });
  // A change of role ends the sessions made under the old one.
  if (set.role !== undefined && set.role !== before.role) await endAllSessions(db, id);
  if (moved) await syncMember(db, id);
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
  // Deactivating ends their sessions for good: a later reactivation does not
  // bring an old cookie back to life.
  if (!active) await endAllSessions(db, id);
  await syncMember(db, id);
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

/**
 * Who the command-line script should invite as the first captain: the person
 * on the roster with this name (any letter case), made a captain, or a new
 * captain when nobody has the name. So a captain who is already on the roster
 * keeps their own row, page link and attendance. A name two people share, or
 * one that belongs to someone switched off, is refused: the script cannot
 * tell what is meant.
 */
export async function captainNamed(
  db: Db,
  input: { firstName: string; lastName?: string },
): Promise<{ ok: true; memberId: string; added: boolean } | { ok: false; reason: 'two_match' | 'turned_off' }> {
  const firstName = cleanName(input.firstName, 'firstNameEmpty');
  const lastName = cleanName(input.lastName, null);
  const found = await db
    .select()
    .from(members)
    .where(and(eq(sql`lower(${members.firstName})`, firstName.toLowerCase()), eq(sql`lower(${members.lastName})`, lastName.toLowerCase())));
  if (found.length > 1) return { ok: false, reason: 'two_match' };
  if (found.length === 0) {
    const member = await addMember(db, { firstName, lastName, role: 'captain' }, null);
    return { ok: true, memberId: member.id, added: true };
  }
  if (!found[0].active) return { ok: false, reason: 'turned_off' };
  if (found[0].role !== 'captain') await updateMember(db, found[0].id, { role: 'captain' }, null);
  return { ok: true, memberId: found[0].id, added: false };
}

export type ManageAction = 'deactivate' | 'reactivate' | 'new-code' | 'new-link' | 'edit' | 'role';

/**
 * Who may change whom. A lead looks after members and their own record. Only
 * a captain can change another lead or a captain, or anyone's role. Nobody
 * deactivates or re-roles themselves, so a slip cannot lock the last captain
 * out. Throws a UserError when the answer is no.
 */
export async function assertMayManage(db: Db, actorId: string, targetId: string, what: ManageAction): Promise<Member> {
  const [actor] = await db.select().from(members).where(eq(members.id, actorId));
  const [target] = await db.select().from(members).where(eq(members.id, targetId));
  const actorIsLead = !!actor && actor.active && (actor.role === 'lead' || actor.role === 'captain');
  if (!actorIsLead || !target) throw new UserError('leadsAreCaptainOnly');
  const self = actor.id === target.id;
  if (self && (what === 'deactivate' || what === 'role')) {
    throw new UserError(actor.role === 'captain' ? 'notYourself' : 'leadsAreCaptainOnly');
  }
  if (actor.role === 'captain') return target;
  if (what === 'role') throw new UserError('leadsAreCaptainOnly');
  if (target.role !== 'member' && !self) throw new UserError('leadsAreCaptainOnly');
  return target;
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
  const [rows, teams] = await Promise.all([
    db
      .select({ member: members, loginName: leadLogins.loginName })
      .from(members)
      .leftJoin(leadLogins, eq(leadLogins.memberId, members.id))
      .orderBy(asc(members.firstName), asc(members.lastName)),
    memberships(db),
  ]);
  return rows.map((r) => ({ ...r.member, subteams: teams.get(r.member.id)?.subteams ?? [], hasLogin: r.loginName !== null }));
}

/**
 * Makes a subteam, on its own or as part of another one. A name that is
 * already there (any letter case) hands back that subteam as it is. One level
 * only: a subteam that is part of another cannot have one under it.
 */
export async function addSubteam(db: Db, name: string, parentId: string | null = null): Promise<Subteam> {
  const clean = cleanName(name, 'subteamEmpty');
  const [existing] = await db
    .select()
    .from(subteams)
    .where(sql`lower(${subteams.name}) = lower(${clean})`);
  if (existing) return existing;
  if (parentId) {
    const [parent] = await db.select().from(subteams).where(eq(subteams.id, parentId));
    if (!parent) throw new UserError('generic');
    if (parent.parentId) throw new UserError('subteamNesting');
  }
  const [made] = await db.insert(subteams).values({ name: clean, parentId }).returning();
  return made;
}

export type SubteamRow = Subteam & {
  /** The subteam it is part of, when it is part of one. */
  parentName: string | null;
  /** Active people a task for it goes to: in it, or in a subteam that is part of it. */
  members: number;
  tasks: number;
  /** Someone is in it (switched off or not), a task is for it, or a subteam is part of it. */
  inUse: boolean;
};

/** Every subteam in name order, each followed by the subteams that are part of it. */
export async function listSubteams(db: Db): Promise<SubteamRow[]> {
  const [all, links, taskCounts] = await Promise.all([
    db.select().from(subteams).orderBy(asc(subteams.name)),
    db
      .select({ memberId: memberSubteams.memberId, subteamId: memberSubteams.subteamId, active: members.active })
      .from(memberSubteams)
      .innerJoin(members, eq(memberSubteams.memberId, members.id)),
    db
      .select({ subteamId: tasks.subteamId, n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(isNotNull(tasks.subteamId))
      .groupBy(tasks.subteamId),
  ]);
  const under = (id: string) => all.filter((s) => s.parentId === id);
  return all
    .filter((s) => !s.parentId)
    .flatMap((top) => [top, ...under(top.id)])
    .map((s) => {
      const ids = new Set([s.id, ...under(s.id).map((t) => t.id)]);
      const taskCount = taskCounts.find((t) => t.subteamId === s.id)?.n ?? 0;
      return {
        ...s,
        parentName: all.find((t) => t.id === s.parentId)?.name ?? null,
        members: new Set(links.filter((l) => l.active && ids.has(l.subteamId)).map((l) => l.memberId)).size,
        tasks: taskCount,
        inUse: ids.size > 1 || taskCount > 0 || links.some((l) => l.subteamId === s.id),
      };
    });
}

/** Removes a subteam made by mistake. Only one that nobody is in, no task is for, and no subteam is part of. */
export async function removeSubteam(db: Db, id: string, actorId: string | null): Promise<void> {
  const all = await listSubteams(db);
  const row = all.find((s) => s.id === id);
  if (!row) return;
  if (row.inUse) throw new UserError('subteamInUse');
  await db.delete(subteams).where(eq(subteams.id, id));
  await logChange(db, { actorId, action: 'subteam.remove', entity: 'subteam', entityId: id, detail: { name: row.name } });
}

const HEADER_WORDS = new Set(['name', 'full name', 'first', 'first name', 'last', 'last name', 'subteam', 'subteams', 'team', 'member']);

/**
 * Adds members from pasted text or an uploaded CSV, one person per line:
 *   First Last            First Last, Subteam            First, Last, Subteam
 * Several subteams for one person go in the one cell with semicolons between
 * them. A header row is skipped. Cells may be in quotes. A subteam that does
 * not exist yet is made. Someone already on the roster (same first and last
 * name, any letter case) is not added again.
 */
export async function importRoster(
  db: Db,
  text: string,
  actorId: string | null,
): Promise<{ added: number; skipped: string[]; already: string[] }> {
  let added = 0;
  const skipped: string[] = [];
  const already: string[] = [];
  const existing = new Set(
    (await db.select({ first: members.firstName, last: members.lastName }).from(members)).map((m) =>
      `${m.first} ${m.last}`.trim().toLowerCase(),
    ),
  );
  let first = true;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (first) {
      first = false;
      if (cells.every((c) => HEADER_WORDS.has(c.toLowerCase()))) continue;
    }
    let firstName: string;
    let lastName: string;
    let subteamCell: string;
    if (cells.length >= 3) {
      [firstName, lastName, subteamCell] = cells;
    } else {
      const name = cells[0] ?? '';
      const space = name.indexOf(' ');
      firstName = space === -1 ? name : name.slice(0, space);
      lastName = space === -1 ? '' : name.slice(space + 1);
      subteamCell = cells[1] ?? '';
    }
    const subteamNames = subteamCell.split(';').map((name) => name.trim()).filter(Boolean);
    if (!firstName || firstName.length > NAME_MAX || lastName.length > NAME_MAX || subteamNames.some((name) => name.length > NAME_MAX) || cells.length > 3) {
      skipped.push(line);
      continue;
    }
    const whole = `${firstName} ${lastName}`.trim();
    if (existing.has(whole.toLowerCase())) {
      already.push(whole);
      continue;
    }
    const subteamIds: string[] = [];
    for (const name of subteamNames) subteamIds.push((await addSubteam(db, name)).id);
    await addMember(db, { firstName, lastName, subteamIds }, actorId);
    existing.add(whole.toLowerCase());
    added++;
  }
  return { added, skipped, already };
}

/**
 * The active member whose Slack member id this is, or null. A bad shape is
 * answered without asking the database.
 */
export async function memberBySlackUserId(db: Db, id: unknown): Promise<Member | null> {
  if (typeof id !== 'string' || !SLACK_ID_PATTERN.test(id)) return null;
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.slackUserId, id), eq(members.active, true)));
  return member ?? null;
}

/**
 * A lead records, changes or clears (empty or null) the Slack member id of a
 * member. Keeps the rule the other edits keep, so a lead cannot change
 * another lead or a captain. Returns the reason in words-free form when the
 * id is not accepted; the screen supplies the words.
 */
export async function setSlackUserId(
  db: Db,
  memberId: string,
  value: string | null,
  actorId: string,
): Promise<{ ok: true } | { ok: false; reason: 'shape' | 'taken' }> {
  await assertMayManage(db, actorId, memberId, 'edit');
  const clean = value === null ? '' : String(value).trim();
  if (clean !== '' && !SLACK_ID_PATTERN.test(clean)) return { ok: false, reason: 'shape' };
  const next = clean === '' ? null : clean;
  if (next !== null) {
    const [holder] = await db.select({ id: members.id }).from(members).where(eq(members.slackUserId, next));
    if (holder && holder.id !== memberId) return { ok: false, reason: 'taken' };
  }
  try {
    await db.update(members).set({ slackUserId: next }).where(eq(members.id, memberId));
  } catch (error) {
    // Two leads saving the same id at once: the unique index decides.
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505') return { ok: false, reason: 'taken' };
    throw error;
  }
  // The id itself is not logged: it is the member's key into /done.
  await logChange(db, { actorId, action: 'member.slack_id', entity: 'member', entityId: memberId, detail: { cleared: next === null } });
  return { ok: true };
}
