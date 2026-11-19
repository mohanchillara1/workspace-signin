// Sets up the first captain on a new database, since nobody can log in yet to
// invite them. It adds the captain as a member and prints a one-time link
// where they pick a login name and a password.
//   npm run invite-captain -- "First" "Last"
// The name goes into the database only. It is never written to a file.
import { createInvite } from '../lib/auth/leads';
import { makeDb } from '../lib/db/client';
import { addMember } from '../lib/members';
import { databaseUrl } from './env';

async function main() {
  const [firstName, lastName = ''] = process.argv.slice(2);
  if (!firstName) throw new Error('Give the captain\'s name: npm run invite-captain -- "First" "Last"');
  const { db, pool } = makeDb(databaseUrl());
  try {
    const captain = await addMember(db, { firstName, lastName, role: 'captain' }, null);
    const token = await createInvite(db, { memberId: captain.id, actorId: null, now: new Date(), bootstrap: true });
    console.log('The captain is added. Open this path on the site within 7 days to set a password:');
    console.log(`/invite/${token}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
