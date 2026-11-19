import { and, asc, between, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { chicagoDay } from './day';
import type { Db } from './db/client';
import { attendance, changeLog, members, struckDays, subteams } from './db/schema';
import { logChange } from './log';
import { shortName } from './names';

export type BoardRow = {
  memberId: string;
  /** First name and last initial, for shared screens. */
  name: string;
  /** The whole name, for the leads' dashboard only. */
  fullName: string;
  subteam: string | null;
  firstScanAt: Date | null;
  source: 'kiosk' | 'manual' | null;
};

/**
 * Signs a member in for the Central day of `at`. One statement, safe to call
 * any number of times: only the first call of the day makes a row.
 */
export async function recordScan(
  db: Db,
  input: { memberId: string; at: Date; kioskId: string | null },
): Promise<{ day: string; firstToday: boolean }> {
  const day = chicagoDay(input.at);
  const made = await db
    .insert(attendance)
    .values({ memberId: input.memberId, day, firstScanAt: input.at, source: 'kiosk', kioskId: input.kioskId })
    .onConflictDoNothing({ target: [attendance.memberId, attendance.day] })
    .returning({ id: attendance.id });
  return { day, firstToday: made.length === 1 };
}

/** A lead adds or removes a member's row for a day. Always logged. */
export async function setByHand(
  db: Db,
  input: { memberId: string; day: string; present: boolean; actorId: string; at: Date },
): Promise<void> {
  if (input.present) {
    const made = await db
      .insert(attendance)
      .values({
        memberId: input.memberId,
        day: input.day,
        firstScanAt: input.at,
        source: 'manual',
        recordedById: input.actorId,
      })
      .onConflictDoNothing({ target: [attendance.memberId, attendance.day] })
      .returning({ id: attendance.id });
    if (made.length === 1) {
      await logChange(db, {
        actorId: input.actorId,
        action: 'attendance.add_by_hand',
        entity: 'member',
        entityId: input.memberId,
        detail: { day: input.day },
      });
    }
    return;
  }
  const removed = await db
    .delete(attendance)
    .where(and(eq(attendance.memberId, input.memberId), eq(attendance.day, input.day)))
    .returning({ source: attendance.source, firstScanAt: attendance.firstScanAt });
  if (removed.length === 1) {
    await logChange(db, {
      actorId: input.actorId,
      action: 'attendance.remove_by_hand',
      entity: 'member',
      entityId: input.memberId,
      detail: { day: input.day, was: removed[0].source, firstScanAt: removed[0].firstScanAt.toISOString() },
    });
  }
}

/** Strikes a day (test scans). It stops counting as a meeting day. */
export async function strikeDay(db: Db, day: string, actorId: string): Promise<void> {
  const made = await db
    .insert(struckDays)
    .values({ day, struckById: actorId })
    .onConflictDoNothing()
    .returning({ day: struckDays.day });
  if (made.length === 1) {
    await logChange(db, { actorId, action: 'day.strike', entity: 'day', entityId: day });
  }
}

export async function unstrikeDay(db: Db, day: string, actorId: string): Promise<void> {
  const removed = await db.delete(struckDays).where(eq(struckDays.day, day)).returning({ day: struckDays.day });
  if (removed.length === 1) {
    await logChange(db, { actorId, action: 'day.unstrike', entity: 'day', entityId: day });
  }
}

export async function struckDaysIn(db: Db, range: { from: string; to: string }): Promise<string[]> {
  const rows = await db.select().from(struckDays).where(between(struckDays.day, range.from, range.to));
  return rows.map((r) => r.day).sort();
}

/** Days with at least one kiosk scan that no lead has struck. */
export async function meetingDays(db: Db, range: { from: string; to: string }): Promise<string[]> {
  const struck = db.select({ day: struckDays.day }).from(struckDays);
  const rows = await db
    .selectDistinct({ day: attendance.day })
    .from(attendance)
    .where(
      and(
        eq(attendance.source, 'kiosk'),
        between(attendance.day, range.from, range.to),
        notInArray(attendance.day, struck),
      ),
    )
    .orderBy(asc(attendance.day));
  return rows.map((r) => r.day);
}

/** A member's own count: meeting days attended out of meeting days since they were added. */
export async function memberCount(
  db: Db,
  memberId: string,
  today: string,
): Promise<{ attended: number; meetingDays: number; since: string }> {
  const [member] = await db.select({ createdAt: members.createdAt }).from(members).where(eq(members.id, memberId));
  if (!member) return { attended: 0, meetingDays: 0, since: today };
  const since = chicagoDay(member.createdAt);
  const days = await meetingDays(db, { from: since, to: today });
  if (days.length === 0) return { attended: 0, meetingDays: 0, since };
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendance)
    .where(and(eq(attendance.memberId, memberId), inArray(attendance.day, days)));
  return { attended: row.n, meetingDays: days.length, since };
}

/** Every active member, split by whether they have a row for the day. */
export async function todayBoard(db: Db, day: string): Promise<{ here: BoardRow[]; notHere: BoardRow[] }> {
  const rows = await db
    .select({
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      subteam: subteams.name,
      firstScanAt: attendance.firstScanAt,
      source: attendance.source,
    })
    .from(members)
    .leftJoin(subteams, eq(members.subteamId, subteams.id))
    .leftJoin(attendance, and(eq(attendance.memberId, members.id), eq(attendance.day, day)))
    .where(eq(members.active, true))
    .orderBy(asc(members.firstName), asc(members.lastName));
  const board = rows.map((r) => ({
    memberId: r.memberId,
    name: shortName(r.firstName, r.lastName),
    fullName: `${r.firstName} ${r.lastName}`.trim(),
    subteam: r.subteam,
    firstScanAt: r.firstScanAt,
    source: r.source,
  }));
  const here = board
    .filter((r) => r.firstScanAt !== null)
    .sort((a, b) => a.firstScanAt!.getTime() - b.firstScanAt!.getTime());
  return { here, notHere: board.filter((r) => r.firstScanAt === null) };
}

export type ExportRow = {
  memberId: string;
  day: string;
  firstName: string;
  lastName: string;
  subteam: string;
  firstScanAt: Date;
  source: 'kiosk' | 'manual';
  recordedBy: string;
};

/** Attendance rows in a date range, for the Attendance screen and the CSV. */
export async function attendanceRows(db: Db, range: { from: string; to: string }): Promise<ExportRow[]> {
  const recorder = alias(members, 'recorder');
  const rows = await db
    .select({
      memberId: members.id,
      day: attendance.day,
      firstName: members.firstName,
      lastName: members.lastName,
      subteam: subteams.name,
      firstScanAt: attendance.firstScanAt,
      source: attendance.source,
      recorderFirst: recorder.firstName,
      recorderLast: recorder.lastName,
    })
    .from(attendance)
    .innerJoin(members, eq(attendance.memberId, members.id))
    .leftJoin(subteams, eq(members.subteamId, subteams.id))
    .leftJoin(recorder, eq(attendance.recordedById, recorder.id))
    .where(between(attendance.day, range.from, range.to))
    .orderBy(asc(attendance.day), asc(attendance.firstScanAt));
  return rows.map((r) => ({
    memberId: r.memberId,
    day: r.day,
    firstName: r.firstName,
    lastName: r.lastName,
    subteam: r.subteam ?? '',
    firstScanAt: r.firstScanAt,
    source: r.source,
    recordedBy: r.recorderFirst ? `${r.recorderFirst} ${r.recorderLast ?? ''}`.trim() : '',
  }));
}

export type DayChange = {
  at: Date;
  who: string;
  what: 'added' | 'removed' | 'struck' | 'unstruck';
  member: string;
};

/** What leads changed by hand for one day, oldest first, with whole names. */
export async function changesFor(db: Db, day: string): Promise<DayChange[]> {
  const actor = alias(members, 'actor');
  const target = alias(members, 'target');
  const rows = await db
    .select({
      at: changeLog.at,
      action: changeLog.action,
      actorFirst: actor.firstName,
      actorLast: actor.lastName,
      targetFirst: target.firstName,
      targetLast: target.lastName,
    })
    .from(changeLog)
    .leftJoin(actor, eq(changeLog.actorId, actor.id))
    .leftJoin(target, sql`${changeLog.entity} = 'member' and ${changeLog.entityId} = ${target.id}::text`)
    .where(
      or(
        and(
          inArray(changeLog.action, ['attendance.add_by_hand', 'attendance.remove_by_hand']),
          sql`${changeLog.detail}->>'day' = ${day}`,
        ),
        and(inArray(changeLog.action, ['day.strike', 'day.unstrike']), eq(changeLog.entityId, day)),
      ),
    )
    .orderBy(asc(changeLog.at));
  const what = {
    'attendance.add_by_hand': 'added',
    'attendance.remove_by_hand': 'removed',
    'day.strike': 'struck',
    'day.unstrike': 'unstruck',
  } as const;
  return rows.map((r) => ({
    at: r.at,
    who: `${r.actorFirst ?? ''} ${r.actorLast ?? ''}`.trim(),
    what: what[r.action as keyof typeof what],
    member: `${r.targetFirst ?? ''} ${r.targetLast ?? ''}`.trim(),
  }));
}
