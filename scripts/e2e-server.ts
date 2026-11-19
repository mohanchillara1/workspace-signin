// Starts everything the browser tests need and nothing they don't: a throwaway
// Postgres with the base seed, and the built app pointed at it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDb } from '../lib/db/client';
import { ensureDatabase, startLocalPostgres } from '../lib/db/local';
import { migrateUrl } from '../lib/db/migrate';
import { seedBase } from '../lib/seed';

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 4321);
const DB_PORT = Number(process.env.E2E_DB_PORT ?? 54330);

async function main() {
  const dir = join(mkdtempSync(join(tmpdir(), 'signin-e2e-pg-')), 'data');
  const pg = await startLocalPostgres({ dir, port: DB_PORT, persistent: false, fresh: true });
  await ensureDatabase(pg.url('postgres'), 'e2e');
  const dbUrl = pg.url('e2e');
  await migrateUrl(dbUrl);
  const password = `local-${randomBytes(9).toString('base64url')}`;
  const { db, pool } = makeDb(dbUrl);
  await seedBase(db, { captainPassword: password });
  await pool.end();

  const baseUrl = `http://127.0.0.1:${APP_PORT}`;
  mkdirSync('.e2e', { recursive: true });
  writeFileSync('.e2e/state.json', JSON.stringify({ dbUrl, baseUrl, captain: { loginName: 'testcaptain', password } }));

  const app = spawn('npx', ['next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      SESSION_SECRET: randomBytes(32).toString('base64url'),
      KIOSK_TEST_FEED: '1',
      KIOSK_IDLE_SECONDS: '3',
    },
  });
  const stop = async () => {
    app.kill('SIGTERM');
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  app.on('exit', (code) => {
    pg.stop().finally(() => process.exit(code ?? 0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
