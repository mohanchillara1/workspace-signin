// A member's own login name and password. Logging in only sends a member to
// their own page (/m/<pageKey>); it never opens the dashboard.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { leadLogins, memberLogins, members } from '../db/schema';
import { UserError } from '../errors';
import { logChange } from '../log';
import { LOGIN_NAME_PATTERN, normalLoginName } from './leads';
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from './password';

/** Sets (or replaces) a member's login. Login names are unique across leads and members. */
export async function setMemberLogin(
  db: Db,
  input: { memberId: string; loginName: string; password: string; actorId: string | null; now: Date },
): Promise<void> {
  const loginName = normalLoginName(input.loginName);
  if (!LOGIN_NAME_PATTERN.test(loginName)) throw new UserError('memberLoginName');
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    throw new UserError('memberLoginPassword');
  }
  const [member] = await db.select().from(members).where(eq(members.id, input.memberId));
  if (!member || !member.active) throw new UserError('generic');
  const [leadTaken] = await db.select().from(leadLogins).where(eq(leadLogins.loginName, loginName));
  const [memberTaken] = await db.select().from(memberLogins).where(eq(memberLogins.loginName, loginName));
  if (leadTaken || (memberTaken && memberTaken.memberId !== member.id)) throw new UserError('memberLoginTaken');
  const passwordHash = await hashPassword(input.password);
  await db
    .insert(memberLogins)
    .values({ memberId: member.id, loginName, passwordHash, updatedAt: input.now })
    .onConflictDoUpdate({ target: memberLogins.memberId, set: { loginName, passwordHash, updatedAt: input.now } });
  await logChange(db, { actorId: input.actorId, action: 'member.set_login', entity: 'member', entityId: member.id });
}

/** The page key a member login opens, or null. Rate limits are counted by the caller (checkLogin). */
export async function checkMemberLogin(db: Db, input: { loginName: string; password: string }): Promise<string | null> {
  const loginName = normalLoginName(input.loginName).slice(0, 64);
  const [found] = await db
    .select({ login: memberLogins, member: members })
    .from(memberLogins)
    .innerJoin(members, eq(memberLogins.memberId, members.id))
    .where(eq(memberLogins.loginName, loginName));
  if (!found || !found.member.active) return null;
  const ok = await verifyPassword(found.login.passwordHash, input.password.slice(0, PASSWORD_MAX));
  return ok ? found.member.pageKey : null;
}

/** Login names by member id, for the Members screen. */
export async function memberLoginNames(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ memberId: memberLogins.memberId, loginName: memberLogins.loginName }).from(memberLogins);
  return new Map(rows.map((r) => [r.memberId, r.loginName]));
}
