import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { makeDb } from './client';
import { storeStatementLimit } from './limit';

/** Brings a database up to the newest migration in drizzle/, and stores the statement limit in it. */
export async function migrateUrl(url: string): Promise<void> {
  const { db, pool } = makeDb(url);
  try {
    await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
  } finally {
    await pool.end();
  }
  await storeStatementLimit(url);
}
