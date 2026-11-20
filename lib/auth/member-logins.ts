// Members open their own page by typing their first and last name. There is no
// password: the page holds their QR code and tasks, nothing of anyone else's,
// and never the dashboard. Leads and captains log in with a password instead.
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { members } from '../db/schema';
import { hit, unhit } from '../rate-limit';

const WINDOW_SECONDS = 15 * 60;
// Names not on the list, from one address, before it has to wait. A whole team
// on one wifi logging in correctly never counts: a match gives its try back.
const MISSES_PER_ADDRESS = 20;

export type NameLoginResult =
  | { ok: true; pageKey: string }
  | { ok: false; reason: 'not_found' | 'two_match' | 'locked' };

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 60);
const tidyColumn = (column: typeof members.firstName | typeof members.lastName) => sql`lower(regexp_replace(trim(${column}), '\\s+', ' ', 'g'))`;

/** The page a first and last name open, matched without regard to case or extra spaces. */
export async function logInByName(
  db: Db,
  input: { firstName: string; lastName: string; ip: string; now: Date },
): Promise<NameLoginResult> {
  const key = { key: `name-login-ip:${input.ip}`, windowSeconds: WINDOW_SECONDS, now: input.now };
  const counted = await hit(db, { ...key, limit: MISSES_PER_ADDRESS });
  if (!counted.allowed) return { ok: false, reason: 'locked' };

  const first = tidy(input.firstName);
  const last = tidy(input.lastName);
  if (!first || !last) return { ok: false, reason: 'not_found' };
  const found = await db
    .select({ pageKey: members.pageKey })
    .from(members)
    .where(and(eq(members.active, true), eq(tidyColumn(members.firstName), first), eq(tidyColumn(members.lastName), last)));
  if (found.length === 0) return { ok: false, reason: 'not_found' };
  await unhit(db, key);
  if (found.length > 1) return { ok: false, reason: 'two_match' };
  return { ok: true, pageKey: found[0].pageKey };
}
