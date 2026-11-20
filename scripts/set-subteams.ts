// Sets which subteams people are in, from a file.
//   npm run set-subteams -- path/to/subteams.csv
// One person per line: "First Last, Subteam; Another subteam". A first row
// that starts with "name" is skipped. Each person ends up in exactly the
// subteams on their line; a person with none on their line ends up in none.
// People who are not in the file are left as they are.
//
// It adds nobody and makes no subteam: a name that is not on the roster, or a
// subteam that does not exist, stops it before anything changes. It prints
// counts and subteam names, never a person's name, and it never changes the
// file. Keep the file out of the repo: it has real names in it.
//
// A database that is not on this machine needs --hosted.
import { readFileSync } from 'node:fs';
import { SheetError } from '../lib/attendance-sheet';
import { makeDb } from '../lib/db/client';
import { listMembers, listSubteams } from '../lib/members';
import { parseSubteamSheet, setSubteamsFromSheet } from '../lib/subteam-sheet';
import { databaseUrl, describeDatabase, isLocal } from './env';

async function main() {
  const args = process.argv.slice(2);
  const hosted = args.includes('--hosted');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--hosted');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}.`);
  if (paths.length !== 1) throw new Error('Usage: npm run set-subteams -- path/to/subteams.csv [--hosted]');

  const sheet = parseSubteamSheet(readFileSync(paths[0], 'utf8'));
  const asked = sheet.people.reduce((n, person) => n + person.subteams.length, 0);
  console.log(`The file: ${sheet.people.length} people, ${asked} places in subteams, ${sheet.people.filter((p) => p.subteams.length === 0).length} people in none.`);

  const url = databaseUrl();
  if (!isLocal(url) && !hosted) throw new Error('Refusing: DATABASE_URL does not point at this machine. Add --hosted if that is what you mean.');
  const { db, pool } = makeDb(url);
  try {
    // Read from the database each time, not worked out from what was set.
    const read = async () => {
      const people = (await listMembers(db)).filter((m) => m.active);
      const out = [
        `${people.length} people switched on: ${people.filter((m) => m.subteams.length > 1).length} in more than one subteam, ` +
          `${people.filter((m) => m.subteams.length === 1).length} in one, ${people.filter((m) => m.subteams.length === 0).length} in none.`,
      ];
      for (const s of await listSubteams(db)) {
        const inIt = people.filter((m) => m.subteams.some((t) => t.id === s.id)).length;
        out.push(`  ${s.parentName ? '  ' : ''}${s.name}: ${inIt} in it, a task for it goes to ${s.members}.`);
      }
      return out.join('\n');
    };
    console.log(`The database (${describeDatabase(url)}) before:\n${await read()}`);
    const result = await setSubteamsFromSheet(db, sheet);
    console.log(`Changed: ${result.changed} of the ${result.people} people in the file.`);
    console.log(`The database after:\n${await read()}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // A database error can quote the row it was writing, name and all. Only the
  // messages written for this script are printed; anything else gets its code.
  const plain = error instanceof SheetError || (error instanceof Error && !('query' in error) && !('cause' in error && error.cause));
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? 'no code';
  console.error(plain ? (error as Error).message : `It stopped and nothing was changed (database error, ${code}).`);
  process.exit(1);
});
