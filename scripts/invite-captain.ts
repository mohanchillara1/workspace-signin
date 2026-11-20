// Sets up the first captain on a new database, since nobody can log in yet to
// invite them. It adds the captain as a member and prints a one-time link
// where they pick a login name and a password.
//   npm run invite-captain -- "First" "Last"
// The name goes into the database only. It is never written to a file.
//
// For a lead who is already there (the seeded "Test Captain" on a test copy):
//   npm run invite-captain -- --login testcaptain
// Their old password stops working and the link lets them set a new one.
//
// To keep the link off the screen, have it written to a new file instead:
//   ... --base https://the-site.example --out /path/to/new-file.txt
// The whole link becomes the only line of that file. An existing file is
// never overwritten.
import { writeFileSync } from 'node:fs';
import { createInvite, leadByLoginName } from '../lib/auth/leads';
import { makeDb } from '../lib/db/client';
import { addMember } from '../lib/members';
import { databaseUrl } from './env';

function readArgs(argv: string[]) {
  const names: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value.`);
      flags[arg.slice(2)] = value;
    } else {
      names.push(arg);
    }
  }
  for (const key of Object.keys(flags)) {
    if (!['login', 'base', 'out'].includes(key)) throw new Error(`Unknown option --${key}.`);
  }
  return { names, flags };
}

async function main() {
  const { names, flags } = readArgs(process.argv.slice(2));
  const [firstName, lastName = ''] = names;
  if (!firstName && !flags.login) {
    throw new Error('Give the captain\'s name: npm run invite-captain -- "First" "Last"   (or --login <login name>)');
  }
  if (flags.out && !flags.base) throw new Error('--out needs --base, the site\'s address, so the file holds a whole link.');
  const base = flags.base ? new URL(flags.base).origin : '';

  const { db, pool } = makeDb(databaseUrl());
  try {
    let memberId: string;
    if (flags.login) {
      const lead = await leadByLoginName(db, flags.login);
      if (!lead) throw new Error(`No lead or captain logs in as "${flags.login}".`);
      memberId = lead.id;
    } else {
      memberId = (await addMember(db, { firstName, lastName, role: 'captain' }, null)).id;
    }
    const token = await createInvite(db, { memberId, actorId: null, now: new Date(), bootstrap: true });
    const link = `${base}/invite/${token}`;
    if (flags.out) {
      // 'wx' refuses a file that is already there.
      writeFileSync(flags.out, `${link}\n`, { flag: 'wx', mode: 0o600 });
      console.log(`The invite link is in ${flags.out}. It works once, for 7 days.`);
    } else {
      console.log(flags.login ? 'Open this within 7 days to set a new password:' : 'The captain is added. Open this path on the site within 7 days to set a password:');
      console.log(link);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
