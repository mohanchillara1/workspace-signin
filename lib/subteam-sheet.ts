// Who is in which subteams, read from a file and set on people who are
// already on the roster. It adds no person and no subteam.
import { SheetError } from './attendance-sheet';
import { parseCsvLine } from './csv';
import type { Db } from './db/client';
import { members, subteams } from './db/schema';
import { updateMember } from './members';
import { memberships } from './subteams';

export type SubteamSheet = { people: { line: number; name: string; subteams: string[] }[] };

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One person per line: `First Last, Subteam; Another subteam`. A first row
 * that starts with "name" is skipped. A person with nothing after their name
 * is to be in no subteam. A problem names the line, never what is on it.
 */
export function parseSubteamSheet(text: string): SubteamSheet {
  const people: SubteamSheet['people'] = [];
  const seen = new Map<string, number>();
  let first = true;
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = index + 1;
      if (!raw.trim()) return;
      const cells = parseCsvLine(raw);
      const header = first && tidy(cells[0]) === 'name';
      first = false;
      if (header) return;
      if (cells.length > 2) throw new SheetError(`Line ${line} has more than two cells. Put the name first, then the subteams with semicolons between them.`);
      if (!cells[0]) throw new SheetError(`Line ${line} has no name.`);
      const before = seen.get(tidy(cells[0]));
      if (before) throw new SheetError(`Lines ${before} and ${line} are the same person.`);
      seen.set(tidy(cells[0]), line);
      const names = (cells[1] ?? '').split(';').map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean);
      people.push({ line, name: cells[0], subteams: [...new Map(names.map((name) => [tidy(name), name])).values()] });
    });
  if (people.length === 0) throw new SheetError('The file has nobody in it.');
  return { people };
}

export type SubteamSheetResult = {
  /** People in the file. */
  people: number;
  /** People whose subteams are different now. */
  changed: number;
  /** People in the file who are to be in no subteam. */
  inNone: number;
  /** Places in subteams the file asks for, counting a person once for each subteam. */
  places: number;
};

/**
 * Puts each person in the file in exactly the subteams the file gives them.
 * All of it or none: a name that is not on the roster (or that two people
 * share), or a subteam that does not exist, stops it before anything changes.
 * People who are not in the file are left as they are.
 */
export async function setSubteamsFromSheet(db: Db, sheet: SubteamSheet): Promise<SubteamSheetResult> {
  return db.transaction(async (tx) => {
    const roster = new Map<string, string[]>();
    for (const m of await tx.select({ id: members.id, first: members.firstName, last: members.lastName }).from(members)) {
      const key = tidy(`${m.first} ${m.last}`);
      roster.set(key, [...(roster.get(key) ?? []), m.id]);
    }
    const teams = new Map((await tx.select({ id: subteams.id, name: subteams.name }).from(subteams)).map((s) => [tidy(s.name), s.id]));

    const notOnRoster: number[] = [];
    const shared: number[] = [];
    const noSuchSubteam: number[] = [];
    const todo: { memberId: string; subteamIds: string[] }[] = [];
    for (const person of sheet.people) {
      const found = roster.get(tidy(person.name)) ?? [];
      if (found.length === 0) notOnRoster.push(person.line);
      if (found.length > 1) shared.push(person.line);
      const ids = person.subteams.map((name) => teams.get(tidy(name)));
      if (ids.some((id) => !id)) noSuchSubteam.push(person.line);
      if (found.length === 1 && ids.every((id) => id)) todo.push({ memberId: found[0], subteamIds: ids as string[] });
    }
    const problems = [
      notOnRoster.length ? `A name that is not on the roster: ${lines(notOnRoster)}.` : '',
      shared.length ? `A name two people on the roster share: ${lines(shared)}.` : '',
      noSuchSubteam.length ? `A subteam that does not exist: ${lines(noSuchSubteam)}.` : '',
    ].filter(Boolean);
    if (problems.length) throw new SheetError(`Nothing was changed. ${problems.join(' ')}`);

    const before = await memberships(tx);
    let changed = 0;
    for (const { memberId, subteamIds } of todo) {
      const had = (before.get(memberId)?.subteams ?? []).map((s) => s.id);
      if (had.length !== subteamIds.length || had.some((id) => !subteamIds.includes(id))) changed++;
      await updateMember(tx, memberId, { subteamIds }, null);
    }
    return {
      people: sheet.people.length,
      changed,
      inNone: sheet.people.filter((p) => p.subteams.length === 0).length,
      places: sheet.people.reduce((sum, p) => sum + p.subteams.length, 0),
    };
  });
}

const lines = (numbers: number[]) => `${numbers.length === 1 ? 'line' : 'lines'} ${numbers.join(', ')}`;
