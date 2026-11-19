// Fills the local development database with made-up people and tasks.
//   npm run db      (in another terminal, first)
//   npm run seed
// It refuses any database that is not on this machine, so made-up rows can
// never land next to real ones.
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { chicagoDay } from '../lib/day';
import { makeDb } from '../lib/db/client';
import { members } from '../lib/db/schema';
import { seedDemo } from '../lib/seed';
import { databaseUrl, isLocal } from './env';

async function main() {
  const url = databaseUrl();
  if (!isLocal(url)) throw new Error('Refusing to seed: DATABASE_URL does not point at this machine.');
  const { db, pool } = makeDb(url);
  try {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members);
    if (n > 0) throw new Error(`Refusing to seed: the database already has ${n} members.`);
    const password = `local-${randomBytes(9).toString('base64url')}`;
    const info = await seedDemo(db, { captainPassword: password, today: chicagoDay(new Date()) });
    console.log('Seeded made-up subteams, twelve people and tasks of every kind.');
    console.log(`Lead login:   ${info.captain.loginName}`);
    console.log(`Password:     ${password}   (made just now, for this machine only)`);
    console.log(`A member page: http://127.0.0.1:4320/m/${info.members.A.pageKey}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
