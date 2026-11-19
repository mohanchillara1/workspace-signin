import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { copy } from '../copy';
import type { Db } from '../db/client';
import { UserError } from '../errors';
import { invites, leadLogins, members, type Member } from '../db/schema';
import { newToken, sha256 } from '../ids';
import { logChange } from '../log';
import { hit, peek } from '../rate-limit';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from './password';

const INVITE_DAYS = 7;
const LOCK_WINDOW_SECONDS = 15 * 60;
const WRONG_PER_NAME = 5;
const WRONG_PER_ADDRESS = 20;
const LOGIN_NAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
// A stored value no password can match. Set when a new invite goes out.
const NO_PASSWORD = '!';

const isLead = (member: Member | undefined | null): member is Member =>
  !!member && member.active && (member.role === 'lead' || member.role === 'captain');

export function normalLoginName(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Makes a one-time link that lets a lead set their password. Only a captain
 * may make one; `bootstrap` is for the command-line script that sets up the
 * first captain. Sending a new invite ends that lead's sessions and stops
 * their old password.
 */
export async function createInvite(
  db: Db,
  input: { memberId: string; actorId: string | null; now: Date; bootstrap?: boolean },
): Promise<string> {
  if (input.actorId) {
    const [actor] = await db.select().from(members).where(eq(members.id, input.actorId));
    if (!actor || !actor.active || actor.role !== 'captain') throw new UserError(copy.errors.captainOnly);
  } else if (!input.bootstrap) {
    throw new UserError(copy.errors.captainOnly);
  }
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  if (!isLead(member)) throw new UserError(copy.errors.notALead);

  const token = newToken();
  await db.insert(invites).values({
    memberId: member.id,
    tokenHash: sha256(token),
    createdById: input.actorId,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + INVITE_DAYS * 86_400_000),
  });
  await db
    .update(leadLogins)
    .set({ passwordHash: NO_PASSWORD, version: sql`${leadLogins.version} + 1`, updatedAt: input.now })
    .where(eq(leadLogins.memberId, member.id));
  await logChange(db, { actorId: input.actorId, action: 'lead.invite', entity: 'member', entityId: member.id });
  return token;
}

/** Who an invite link is for, if the link is still good. */
export async function inviteMember(db: Db, token: unknown, now: Date): Promise<Member | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [found] = await db
    .select({ member: members })
    .from(invites)
    .innerJoin(members, eq(invites.memberId, members.id))
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), gt(invites.expiresAt, now)));
  return isLead(found?.member) ? found.member : null;
}

export type AcceptResult =
  | { ok: true; memberId: string; version: number }
  | { ok: false; reason: 'bad_link' | 'weak_password' | 'bad_name' | 'name_taken' };

/** A lead opens their invite link and picks a login name and a password. */
export async function acceptInvite(
  db: Db,
  input: { token: unknown; loginName: string; password: string; now: Date },
): Promise<AcceptResult> {
  const member = await inviteMember(db, input.token, input.now);
  if (!member) return { ok: false, reason: 'bad_link' };
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    return { ok: false, reason: 'weak_password' };
  }
  const loginName = normalLoginName(input.loginName);
  if (!LOGIN_NAME_PATTERN.test(loginName)) return { ok: false, reason: 'bad_name' };
  const [taken] = await db
    .select({ memberId: leadLogins.memberId })
    .from(leadLogins)
    .where(and(eq(leadLogins.loginName, loginName), ne(leadLogins.memberId, member.id)));
  if (taken) return { ok: false, reason: 'name_taken' };

  const passwordHash = await hashPassword(input.password);
  const [login] = await db
    .insert(leadLogins)
    .values({ memberId: member.id, loginName, passwordHash, updatedAt: input.now })
    .onConflictDoUpdate({
      target: leadLogins.memberId,
      set: { loginName, passwordHash, version: sql`${leadLogins.version} + 1`, updatedAt: input.now },
    })
    .returning({ version: leadLogins.version });
  await db
    .update(invites)
    .set({ usedAt: input.now })
    .where(and(eq(invites.memberId, member.id), isNull(invites.usedAt)));
  await logChange(db, { actorId: member.id, action: 'lead.set_password', entity: 'member', entityId: member.id });
  return { ok: true, memberId: member.id, version: login.version };
}

let dummyHash: Promise<string> | undefined;

export type LoginResult =
  | { ok: true; memberId: string; version: number }
  | { ok: false; reason: 'wrong' | 'locked' };

/**
 * Checks a login name and password. A wrong password and an unknown name get
 * the same answer. Five wrong tries on a name, or twenty from one address,
 * lock it for the rest of a 15-minute window.
 */
export async function checkLogin(
  db: Db,
  input: { loginName: string; password: string; ip: string; now: Date },
): Promise<LoginResult> {
  const loginName = normalLoginName(input.loginName).slice(0, 64);
  const nameKey = `login-name:${loginName}`;
  const addressKey = `login-ip:${input.ip}`;
  const window = { windowSeconds: LOCK_WINDOW_SECONDS, now: input.now };
  const [byName, byAddress] = await Promise.all([
    peek(db, { key: nameKey, ...window }),
    peek(db, { key: addressKey, ...window }),
  ]);
  if (byName >= WRONG_PER_NAME || byAddress >= WRONG_PER_ADDRESS) return { ok: false, reason: 'locked' };

  const [found] = await db
    .select({ login: leadLogins, member: members })
    .from(leadLogins)
    .innerJoin(members, eq(leadLogins.memberId, members.id))
    .where(eq(leadLogins.loginName, loginName));
  // Always spend the time of one hash check, so a missing name looks the same.
  dummyHash ??= hashPassword('not a real password');
  const matches = await verifyPassword(found?.login.passwordHash ?? (await dummyHash), input.password.slice(0, PASSWORD_MAX));
  if (!found || !matches || !isLead(found.member)) {
    await hit(db, { key: nameKey, limit: WRONG_PER_NAME, ...window });
    await hit(db, { key: addressKey, limit: WRONG_PER_ADDRESS, ...window });
    return { ok: false, reason: 'wrong' };
  }
  return { ok: true, memberId: found.member.id, version: found.login.version };
}

/** The lead a session cookie stands for, or null if it should no longer work. */
export async function leadForSession(
  db: Db,
  session: { memberId?: string; version?: number },
): Promise<Member | null> {
  if (!session.memberId || typeof session.version !== 'number') return null;
  const [found] = await db
    .select({ login: leadLogins, member: members })
    .from(leadLogins)
    .innerJoin(members, eq(leadLogins.memberId, members.id))
    .where(eq(leadLogins.memberId, session.memberId));
  if (!found || found.login.version !== session.version || !isLead(found.member)) return null;
  return found.member;
}
