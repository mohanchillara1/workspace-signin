// Brings a season's attendance in from the team's old sheet, saved as CSV.
//   npm run import-attendance -- path/to/attendance.csv
// The first row is "name" and then one day in each column (2026-09-07). Each
// row after it is a person, with TRUE or FALSE under each day.
//
// It adds anyone in the file who is not on the roster yet and one attendance
// row for each TRUE. Running it again adds nothing. It prints counts and never
// a name, and it never changes the file. Keep the file out of the repo: it has
// real names in it.
//
// A database that is not on this machine needs --hosted, so a real roster
// cannot go to a host by accident.
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { meetingDays } from '../lib/attendance';
import { importSheet, parseSheet, SheetError } from '../lib/attendance-sheet';
import { makeDb } from '../lib/db/client';
import { attendance, members } from '../lib/db/schema';
import { databaseUrl, describeDatabase, isLocal } from './env';

const ALL_DAYS = { from: '2000-01-01', to: '2999-12-31' };

async function main() {
  const args = process.argv.slice(2);
  const hosted = args.includes('--hosted');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--hosted');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}.`);
  if (paths.length !== 1) throw new Error('Usage: npm run import-attendance -- path/to/attendance.csv [--hosted]');

  const sheet = parseSheet(readFileSync(paths[0], 'utf8'));
  const marks = sheet.people.reduce((n, person) => n + person.days.length, 0);
  console.log(`The file: ${sheet.people.length} people, ${sheet.days.length} days, ${marks} present marks.`);

  const url = databaseUrl();
  if (!isLocal(url) && !hosted) throw new Error('Refusing: DATABASE_URL does not point at this machine. Add --hosted if that is what you mean.');
  const { db, pool } = makeDb(url);
  try {
    // Read from the database each time, not worked out from what was added.
    const read = async () => {
      const [people] = await db.select({ n: sql<number>`count(*)::int` }).from(members);
      const [rows] = await db.select({ n: sql<number>`count(*)::int` }).from(attendance);
      return `${people.n} people, ${rows.n} attendance rows, ${(await meetingDays(db, ALL_DAYS)).length} meeting days`;
    };
    console.log(`The database (${describeDatabase(url)}) before: ${await read()}.`);
    const result = await importSheet(db, sheet, new Date());
    console.log(`Added: ${result.peopleAdded} people, ${result.rowsAdded} attendance rows.`);
    console.log(`The database after: ${await read()}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // A database error can quote the row it was writing, name and all. Only the
  // messages written for this script are printed; anything else gets its code.
  const plain = error instanceof SheetError || (error instanceof Error && !('query' in error) && !('cause' in error && error.cause));
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code ?? 'no code';
  console.error(plain ? (error as Error).message : `The import stopped and nothing was added (database error, ${code}).`);
  process.exit(1);
});
