// Fills a database with made-up people and tasks.
//   npm run db      (in another terminal, first)
//   npm run seed
// It refuses any database that is not on this machine, so made-up rows can
// never land next to real ones. The one exception is a hosted test copy: a
// database whose own settings say TEST_COPY=1.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { chicagoDay } from '../lib/day';
import { makeDb } from '../lib/db/client';
import { members } from '../lib/db/schema';
import { seedDemo } from '../lib/seed';
import { isTestCopy } from '../lib/test-copy';
import { databaseUrl, describeDatabase, isLocal, seedRefusal } from './env';

async function main() {
  const url = databaseUrl();
  const refusal = seedRefusal(url, isTestCopy());
  if (refusal) throw new Error(refusal);
  const { db, pool } = makeDb(url);
  try {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members);
    if (n > 0) throw new Error(`Refusing to seed: the database already has ${n} members.`);
    const local = isLocal(url);
    const password = `${local ? 'local' : 'unused'}-${randomBytes(local ? 9 : 24).toString('base64url')}`;
    const info = await seedDemo(db, { captainPassword: password, today: chicagoDay(new Date()) });
    console.log(`Seeded the database (${describeDatabase(url)}) with made-up subteams, twelve people and tasks of every kind.`);
    if (local) {
      console.log(`Lead login:   ${info.captain.loginName}`);
      console.log(`Password:     ${password}   (made just now, for this machine only)`);
      console.log(`A member page: http://127.0.0.1:4320/m/${info.members.A.pageKey}`);
    } else {
      // Nothing that opens a hosted copy is printed. The seeded captain's
      // password is thrown away; a captain gets in with an invite link.
      console.log('Hosted test copy: no password or page link is printed. Make an invite link for "Test Captain" to log in.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
