import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

type Root = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Root['transaction']>[0]>[0];

/** A database handle or a transaction on one. Every lib function takes this. */
export type Db = Root | Tx;

export function makeDb(url: string): { db: Root; pool: Pool } {
  const pool = new Pool({
    connectionString: url,
    // A serverless host runs many copies of the app; each keeps a small pool.
    max: Number(process.env.DB_POOL_MAX ?? 5),
    // Fail in seconds, not minutes, when the database is slow or away, so the
    // kiosk can say so.
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    query_timeout: 10000,
  });
  return { db: drizzle(pool, { schema }), pool };
}

const held = globalThis as unknown as { __signinDb?: Root };

/** The app's database, from DATABASE_URL. One pool per server process. */
export function getDb(): Root {
  if (!held.__signinDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set. Run "npm run db" and copy .env.example to .env.local.');
    held.__signinDb = makeDb(url).db;
  }
  return held.__signinDb;
}
