// Fills a database with made-up people and tasks.
//   npm run db      (in another terminal, first)
//   npm run seed
// It refuses any database that is not on this machine, so made-up rows can
// never land next to real ones. The one exception is a hosted test copy: a
// database whose own settings say TEST_COPY=1.
import { randomBytes } from 'node:crypto';
import { setMemberLogin } from '../lib/auth/member-logins';
import { sql } from 'drizzle-orm';
import { recordScan } from '../lib/attendance';
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
    // On this machine the test logins are fixed and written in the README, so
    // everyone who clones the repo gets the same ones. A hosted copy gets a
    // random password that is thrown away.
    const password = local ? 'test-captain-pass' : `unused-${randomBytes(24).toString('base64url')}`;
    const info = await seedDemo(db, { captainPassword: password, today: chicagoDay(new Date()) });
    console.log(`Seeded the database (${describeDatabase(url)}) with made-up subteams, twelve people and tasks of every kind.`);
    if (local) {
      await setMemberLogin(db, {
        memberId: info.members.A.id,
        loginName: 'testmember',
        password: 'test-member-pass',
        actorId: null,
        now: new Date(),
      });
      // Made-up meetings: three a week for the past four weeks, plus today,
      // so the attendance screens have something to show.
      const people = Object.values(info.members);
      const now = Date.now();
      let made = 0;
      for (let back = 28; back >= 0; back--) {
        const at = new Date(now - back * 86_400_000);
        if (back > 0 && ![2, 4, 6].includes(at.getUTCDay())) continue;
        for (const [i, person] of people.entries()) {
          if (back === 0 ? i % 2 === 1 : (i * 7 + back) % 5 === 0) continue;
          const when = back === 0 ? new Date(now - (i + 1) * 60_000) : new Date(at.getTime() - i * 60_000);
          await recordScan(db, { memberId: person.id, at: when, kioskId: null });
          made++;
        }
      }
      console.log(`Made-up check-ins: ${made}`);
      console.log(`Lead login:   ${info.captain.loginName}`);
      console.log(`Password:     ${password}`);
      console.log('Member login: testmember  /  test-member-pass   (Test Member A)');
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
