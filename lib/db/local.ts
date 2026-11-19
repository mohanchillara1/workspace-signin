// A real Postgres that runs on this machine with no install and no account.
// Used for local development and for tests, never in production.
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

export type LocalPostgres = { port: number; url: (database: string) => string; stop: () => Promise<void> };

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export async function startLocalPostgres(options: {
  dir: string;
  port: number;
  persistent: boolean;
  fresh: boolean;
}): Promise<LocalPostgres> {
  const server = new EmbeddedPostgres({
    databaseDir: options.dir,
    user: 'postgres',
    password: 'postgres',
    port: options.port,
    persistent: options.persistent,
    onLog: () => {},
    onError: () => {},
  });
  if (options.fresh) await server.initialise();
  await server.start();
  const url = (database: string) => `postgres://postgres:postgres@127.0.0.1:${options.port}/${database}`;
  return { port: options.port, url, stop: () => server.stop() };
}

export async function ensureDatabase(adminUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}
