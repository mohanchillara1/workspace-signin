// Brings a season's attendance in from the team's old sheet, saved as CSV:
//   name,2026-09-07,2026-09-08
//   First Last,TRUE,FALSE
// The sheet has days and no times, so a row made here has no scan time. Error
// messages say which line and column, and never repeat what the file holds:
// the file has real names in it and a message can end up in a log.
import { eq } from 'drizzle-orm';
import { parseCsvLine } from './csv';
import { chicagoDay, isDay } from './day';
import type { Db } from './db/client';
import { attendance, members } from './db/schema';
import { logChange } from './log';
import { addMember } from './members';

export type SheetPerson = { line: number; firstName: string; lastName: string; days: string[] };
export type Sheet = { days: string[]; people: SheetPerson[] };
export type ImportCounts = { people: number; days: number; marks: number; peopleAdded: number; rowsAdded: number };

/** Something in the file, or between the file and the roster, that the import will not guess about. */
export class SheetError extends Error {}

const NAME_MAX = 60;
const PRESENT = new Set(['true', 'yes', 'y', 'x', '1', 'present']);
const ABSENT = new Set(['false', 'no', 'n', '0', '', 'absent']);
const sameName = (first: string, last: string) => `${first} ${last}`.replace(/\s+/g, ' ').trim().toLowerCase();

export function parseSheet(text: string): Sheet {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((raw, index) => ({ number: index + 1, cells: raw.trim() ? parseCsvLine(raw) : [] }))
    .filter((line) => line.cells.length > 0);
  if (lines.length === 0) throw new SheetError('The file is empty.');
  const [header, ...rows] = lines;
  if (header.cells[0].toLowerCase() !== 'name') throw new SheetError('The first row must start with "name" and then have one day in each column.');
  const days = header.cells.slice(1);
  if (days.length === 0) throw new SheetError('The first row has no days after "name".');
  days.forEach((day, i) => {
    if (!isDay(day)) throw new SheetError(`The first row, column ${i + 2}: a day must look like 2026-09-07.`);
    const earlier = days.indexOf(day);
    if (earlier !== i) throw new SheetError(`The first row, columns ${earlier + 2} and ${i + 2}, hold the same day.`);
  });

  const seen = new Map<string, number>();
  const people = rows.map(({ number, cells }) => {
    if (cells.length !== header.cells.length) throw new SheetError(`Line ${number} has ${cells.length} cells. The first row has ${header.cells.length}.`);
    const name = cells[0];
    const space = name.indexOf(' ');
    const firstName = space === -1 ? name : name.slice(0, space);
    const lastName = space === -1 ? '' : name.slice(space + 1);
    if (!firstName) throw new SheetError(`Line ${number} has no name.`);
    if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) throw new SheetError(`Line ${number}: the name is too long.`);
    const key = sameName(firstName, lastName);
    const earlier = seen.get(key);
    if (earlier) throw new SheetError(`Lines ${earlier} and ${number} hold the same name.`);
    seen.set(key, number);
    const here: string[] = [];
    cells.slice(1).forEach((cell, i) => {
      const mark = cell.toLowerCase();
      if (PRESENT.has(mark)) here.push(days[i]);
      else if (!ABSENT.has(mark)) throw new SheetError(`Line ${number}, column ${i + 2}: use TRUE or FALSE.`);
    });
    return { line: number, firstName, lastName, days: here };
  });
  return { days, people };
}

/**
 * Adds the people in the sheet who are not on the roster, and one attendance
 * row for each mark. All of it or none of it. Safe to run again: a person
 * already on the roster (same name, any letter case) is used as they are, and
 * a day they already have a row for keeps that row.
 */
export async function importSheet(db: Db, sheet: Sheet, now: Date): Promise<ImportCounts> {
  const firstDay = [...sheet.days].sort()[0];
  const lastDay = [...sheet.days].sort().at(-1)!;
  const marks = sheet.people.reduce((n, person) => n + person.days.length, 0);
  return db.transaction(async (tx) => {
    const roster = await tx
      .select({ id: members.id, firstName: members.firstName, lastName: members.lastName, createdAt: members.createdAt, countsFrom: members.countsFrom })
      .from(members);
    const byName = new Map<string, typeof roster>();
    for (const member of roster) {
      const key = sameName(member.firstName, member.lastName);
      byName.set(key, [...(byName.get(key) ?? []), member]);
    }

    let peopleAdded = 0;
    const rows: (typeof attendance.$inferInsert)[] = [];
    for (const person of sheet.people) {
      const found = byName.get(sameName(person.firstName, person.lastName)) ?? [];
      if (found.length > 1) throw new SheetError(`Line ${person.line} matches two people on the roster.`);
      let member = found[0];
      if (!member) {
        member = await addMember(tx, { firstName: person.firstName, lastName: person.lastName }, null);
        peopleAdded++;
      }
      // The sheet lists everyone for the whole season, so their count runs
      // from its first day, not from the day this row was made.
      if ((member.countsFrom ?? chicagoDay(member.createdAt)) > firstDay) {
        await tx.update(members).set({ countsFrom: firstDay }).where(eq(members.id, member.id));
      }
      for (const day of person.days) rows.push({ memberId: member.id, day, source: 'sheet', firstScanAt: null, addedAt: now });
    }

    const made = rows.length
      ? await tx.insert(attendance).values(rows).onConflictDoNothing({ target: [attendance.memberId, attendance.day] }).returning({ id: attendance.id })
      : [];
    const counts = { people: sheet.people.length, days: sheet.days.length, marks, peopleAdded, rowsAdded: made.length };
    if (peopleAdded > 0 || made.length > 0) {
      // Counts and days only. No name goes into the log.
      await logChange(tx, {
        actorId: null,
        action: 'attendance.import',
        entity: 'sheet',
        detail: { people: counts.people, peopleAdded, days: counts.days, marks, rowsAdded: made.length, firstDay, lastDay },
      });
    }
    return counts;
  });
}
