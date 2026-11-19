// Starts a copy of the built app for a person (or a reviewer) to click
// through, on made-up data, with the test feed on so a code can be fed in
// without a camera.
//   npm run db                       (first, in another terminal)
//   npm run build
//   npm run review -- 4320 signin    (port, database name)
// It writes what a reviewer needs (the lead login, a few members' codes and
// page links) to .data/review-<port>.json, which git ignores. Local only: it
// refuses a database that is not on this machine.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { asc, eq, sql } from 'drizzle-orm';
import { acceptInvite, createInvite } from '../lib/auth/leads';
import { chicagoDay } from '../lib/day';
import { makeDb } from '../lib/db/client';
import { ensureDatabase } from '../lib/db/local';
import { migrateUrl } from '../lib/db/migrate';
import { leadLogins, members } from '../lib/db/schema';
import { seedDemo } from '../lib/seed';
import { databaseUrl, isLocal } from './env';

async function main() {
  const port = Number(process.argv[2] ?? 4320);
  const database = process.argv[3] ?? 'signin';
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error('The database name must be small letters, digits and underscores.');
  const base = new URL(databaseUrl());
  if (!isLocal(base.href)) throw new Error('Refusing: DATABASE_URL does not point at this machine.');
  const admin = new URL(base.href);
  admin.pathname = '/postgres';
  base.pathname = `/${database}`;
  await ensureDatabase(admin.href, database);
  await migrateUrl(base.href);

  const { db, pool } = makeDb(base.href);
  const password = `local-${randomBytes(9).toString('base64url')}`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members);
  if (n === 0) {
    await seedDemo(db, { captainPassword: password, today: chicagoDay(new Date()) });
  } else {
    // Already seeded: give the seed captain a fresh password for this run.
    const [login] = await db.select().from(leadLogins).where(eq(leadLogins.loginName, 'testcaptain'));
    if (!login) throw new Error('This database has members but no seed captain. Use a new database name.');
    const now = new Date();
    const token = await createInvite(db, { memberId: login.memberId, actorId: null, now, bootstrap: true });
    await acceptInvite(db, { token, loginName: 'testcaptain', password, now });
  }
  const people = await db.select().from(members).where(eq(members.active, true)).orderBy(asc(members.lastName)).limit(14);
  await pool.end();

  const url = `http://127.0.0.1:${port}`;
  mkdirSync('.data', { recursive: true });
  const file = `.data/review-${port}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        url,
        note: 'Made-up data on this machine only. The test feed is on: on /kiosk, run window.dispatchEvent(new CustomEvent("kiosk:test-scan", { detail: "<scanCode>" })) to stand in for the camera.',
        lead: { loginName: 'testcaptain', password },
        members: people.map((m) => ({
          name: `${m.firstName} ${m.lastName}`.trim(),
          role: m.role,
          scanCode: m.scanCode,
          page: `${url}/m/${m.pageKey}`,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Review copy: ${url}  (details in ${file})`);

  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: base.href,
      SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString('base64url'),
      KIOSK_TEST_FEED: '1',
      KIOSK_IDLE_SECONDS: process.env.KIOSK_IDLE_SECONDS ?? '15',
    },
  });
  const stop = () => app.kill('SIGTERM');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  app.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
