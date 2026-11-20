import { and, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { endedSessions, invites, leadLogins, members, type Member } from '../db/schema';
import { UserError } from '../errors';
import { newToken, sha256 } from '../ids';
import { logChange } from '../log';
import { hit, unhit } from '../rate-limit';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from './password';

const INVITE_DAYS = 7;
const LOCK_WINDOW_SECONDS = 15 * 60;
const WRONG_PER_NAME = 5;
const WRONG_PER_ADDRESS = 20;
export const LOGIN_NAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const SESSION_DAYS = 14;
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
    if (!actor || !actor.active || actor.role !== 'captain') throw new UserError('captainOnly');
  } else if (!input.bootstrap) {
    throw new UserError('captainOnly');
  }
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  if (!isLead(member)) throw new UserError('notALead');

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

/** The lead who logs in with this name, or null. For the command-line invite script. */
export async function leadByLoginName(db: Db, loginName: string): Promise<Member | null> {
  const [found] = await db
    .select({ member: members })
    .from(leadLogins)
    .innerJoin(members, eq(leadLogins.memberId, members.id))
    .where(eq(leadLogins.loginName, normalLoginName(loginName)));
  return isLead(found?.member) ? found.member : null;
}

export type AcceptResult =
  | { ok: true; memberId: string; version: number }
  | { ok: false; reason: 'bad_link' | 'weak_password' | 'bad_name' | 'name_taken' };

class Refused extends Error {
  constructor(public readonly reason: 'bad_link' | 'name_taken') {
    super(reason);
  }
}

/**
 * A lead opens their invite link and picks a login name and a password. The
 * link is used up and the login is written in one step, so a link opened
 * twice at the same moment still works only once.
 */
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
  const passwordHash = await hashPassword(input.password);
  try {
    const version = await db.transaction(async (tx) => {
      const used = await tx
        .update(invites)
        .set({ usedAt: input.now })
        .where(and(eq(invites.tokenHash, sha256(String(input.token))), isNull(invites.usedAt), gt(invites.expiresAt, input.now)))
        .returning({ memberId: invites.memberId });
      if (used.length !== 1) throw new Refused('bad_link');
      const [taken] = await tx
        .select({ memberId: leadLogins.memberId })
        .from(leadLogins)
        .where(and(eq(leadLogins.loginName, loginName), ne(leadLogins.memberId, member.id)));
      if (taken) throw new Refused('name_taken');
      const [login] = await tx
        .insert(leadLogins)
        .values({ memberId: member.id, loginName, passwordHash, updatedAt: input.now })
        .onConflictDoUpdate({
          target: leadLogins.memberId,
          set: { loginName, passwordHash, version: sql`${leadLogins.version} + 1`, updatedAt: input.now },
        })
        .returning({ version: leadLogins.version });
      // Any other invite still open for this lead is spent too.
      await tx
        .update(invites)
        .set({ usedAt: input.now })
        .where(and(eq(invites.memberId, member.id), isNull(invites.usedAt)));
      await logChange(tx, { actorId: member.id, action: 'lead.set_password', entity: 'member', entityId: member.id });
      return login.version;
    });
    return { ok: true, memberId: member.id, version };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    // Two leads picking the same new name at the same moment: the second insert is refused.
    if (error instanceof Error && /lead_logins_login_name_unique|duplicate key/.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? '')}`)) {
      return { ok: false, reason: 'name_taken' };
    }
    throw error;
  }
}

let dummyHash: Promise<string> | undefined;

export type LoginResult =
  | { ok: true; memberId: string; version: number }
  | { ok: false; reason: 'wrong' | 'locked' };

/**
 * Checks a login name and password. A wrong password and an unknown name get
 * the same answer. Each try is counted before the password is looked at, so
 * many guesses sent at once cannot slip past the count: five wrong tries on
 * a name, or twenty from one address, lock it for the rest of a 15-minute
 * window. A correct password gives its count back.
 */
export async function checkLogin(
  db: Db,
  input: { loginName: string; password: string; ip: string; now: Date },
): Promise<LoginResult> {
  const loginName = normalLoginName(input.loginName).slice(0, 64);
  const nameKey = { key: `login-name:${loginName}`, windowSeconds: LOCK_WINDOW_SECONDS, now: input.now };
  const addressKey = { key: `login-ip:${input.ip}`, windowSeconds: LOCK_WINDOW_SECONDS, now: input.now };
  const [byName, byAddress] = await Promise.all([
    hit(db, { ...nameKey, limit: WRONG_PER_NAME }),
    hit(db, { ...addressKey, limit: WRONG_PER_ADDRESS }),
  ]);
  if (!byName.allowed || !byAddress.allowed) return { ok: false, reason: 'locked' };

  const [found] = await db
    .select({ login: leadLogins, member: members })
    .from(leadLogins)
    .innerJoin(members, eq(leadLogins.memberId, members.id))
    .where(eq(leadLogins.loginName, loginName));
  // Always spend the time of one hash check, so a missing name looks the same.
  dummyHash ??= hashPassword('not a real password');
  const matches = await verifyPassword(found?.login.passwordHash ?? (await dummyHash), input.password.slice(0, PASSWORD_MAX));
  if (!found || !matches || !isLead(found.member)) return { ok: false, reason: 'wrong' };
  await Promise.all([unhit(db, nameKey), unhit(db, addressKey)]);
  return { ok: true, memberId: found.member.id, version: found.login.version };
}

/** What the session cookie holds. */
export type SessionData = { memberId?: string; version?: number; sid?: string };

/** The lead a session cookie stands for, or null if it should no longer work. */
export async function leadForSession(db: Db, session: SessionData): Promise<Member | null> {
  if (!session.memberId || typeof session.version !== 'number' || !session.sid) return null;
  const [ended] = await db.select().from(endedSessions).where(eq(endedSessions.sid, session.sid));
  if (ended) return null;
  const [found] = await db
    .select({ login: leadLogins, member: members })
    .from(leadLogins)
    .innerJoin(members, eq(leadLogins.memberId, members.id))
    .where(eq(leadLogins.memberId, session.memberId));
  if (!found || found.login.version !== session.version || !isLead(found.member)) return null;
  return found.member;
}

/** Logging out. The cookie is cleared, and a copy of it kept elsewhere stops working too. */
export async function endSession(db: Db, sid: string | undefined): Promise<void> {
  if (!sid) return;
  await db.insert(endedSessions).values({ sid }).onConflictDoNothing();
  // A cookie cannot outlive its lifetime, so old entries can go.
  if (Math.random() < 0.05) {
    await db.delete(endedSessions).where(lt(endedSessions.endedAt, new Date(Date.now() - (SESSION_DAYS + 1) * 86_400_000)));
  }
}
