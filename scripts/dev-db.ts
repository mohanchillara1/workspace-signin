// Starts the local Postgres for development and keeps it running.
//   npm run db      (leave it open; Ctrl+C stops it)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDatabase, startLocalPostgres } from '../lib/db/local';
import { migrateUrl } from '../lib/db/migrate';

const dir = join(process.cwd(), '.data', 'pg');
const port = Number(process.env.DEV_DB_PORT ?? 54329);

async function main() {
  const pg = await startLocalPostgres({ dir, port, persistent: true, fresh: !existsSync(join(dir, 'PG_VERSION')) });
  await ensureDatabase(pg.url('postgres'), 'signin');
  await migrateUrl(pg.url('signin'));
  console.log(`Local Postgres is up: ${pg.url('signin')}`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
