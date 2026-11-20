// Gives a member a lead or captain login with a password, with no invite link.
// Use it to set up the team's admins.
//   DATABASE_URL=... npm run set-login -- "First" "Last" --role captain --login mohan
// It asks for the password, so the password never goes into a file or your
// shell history. The member must already be on the roster (add them on the
// Members screen or with a roster paste). Running it again changes the password.
import { createInterface } from 'node:readline/promises';
import { and, eq, sql } from 'drizzle-orm';
import { setLeadLogin } from '../lib/auth/leads';
import { makeDb } from '../lib/db/client';
import { members } from '../lib/db/schema';
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
    } else names.push(arg);
  }
  for (const key of Object.keys(flags)) if (!['role', 'login'].includes(key)) throw new Error(`Unknown option --${key}.`);
  return { names, flags };
}

const REASONS: Record<string, string> = {
  weak_password: 'The password needs at least 5 characters.',
  bad_name: 'The login name needs 3 to 32 lowercase letters, numbers, dots, dashes or underscores.',
  name_taken: 'Someone else already logs in with that name.',
  bad_link: 'That member is turned off.',
};

async function main() {
  const { names, flags } = readArgs(process.argv.slice(2));
  const [firstName, lastName] = names;
  const role = flags.role;
  if (!firstName || !lastName || (role !== 'lead' && role !== 'captain') || !flags.login) {
    throw new Error('Usage: npm run set-login -- "First" "Last" --role lead|captain --login <login name>');
  }
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const password = (await ask.question(`Password for ${flags.login}: `)).trim();
  ask.close();

  const { db, pool } = makeDb(databaseUrl());
  try {
    const found = await db
      .select()
      .from(members)
      .where(and(eq(sql`lower(${members.firstName})`, firstName.toLowerCase()), eq(sql`lower(${members.lastName})`, lastName.toLowerCase())));
    if (found.length !== 1) throw new Error(found.length ? 'Two members have that name.' : 'Nobody on the roster has that name. Add them first.');
    const result = await setLeadLogin(db, { memberId: found[0].id, role, loginName: flags.login, password, now: new Date() });
    if (!result.ok) throw new Error(REASONS[result.reason]);
    console.log(`${firstName} ${lastName} is a ${role} and logs in as "${flags.login.toLowerCase()}".`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
