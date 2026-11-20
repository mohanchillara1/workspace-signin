// The server must stop a statement that runs too long even when the
// connection did not ask it to. A host's proxy can drop what the driver asks
// for at connect time (Neon's does), so this asks the server what is in force
// on a connection that asks for nothing.
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { makeDb } from '@/lib/db/client';
import { STATEMENT_LIMIT_MS, statementLimitInForce, storeStatementLimit } from '@/lib/db/limit';
import { migrateUrl } from '@/lib/db/migrate';
import { sql } from 'drizzle-orm';

async function newDatabase(): Promise<string> {
  const base = inject('pgBase');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: `${base}postgres` });
  await admin.connect();
  await admin.query(`create database "${name}" template template_app`);
  await admin.end();
  return `${base}${name}`;
}

describe('the statement limit', () => {
  it('is 8 seconds', () => {
    expect(STATEMENT_LIMIT_MS).toBe(8000);
  });

  it('is not in force on a plain connection until it is stored in the database', async () => {
    const url = await newDatabase();
    expect(await statementLimitInForce(url)).toEqual({ ms: 0, source: 'default' });
    await storeStatementLimit(url);
    // "database user": a default of this role in this database, not something the connection asked for.
    expect(await statementLimitInForce(url)).toEqual({ ms: 8000, source: 'database user' });
    // Storing it twice is fine.
    await storeStatementLimit(url);
    expect(await statementLimitInForce(url)).toEqual({ ms: 8000, source: 'database user' });
  });

  it('is stored by the migration step, so every database the app is set up on has it', async () => {
    const url = await newDatabase();
    await migrateUrl(url);
    expect(await statementLimitInForce(url)).toEqual({ ms: 8000, source: 'database user' });
  });

  it("is what the app's own connections run under, and the server stops a statement that passes it", async () => {
    const url = await newDatabase();
    await migrateUrl(url);
    const { db, pool } = makeDb(url);
    try {
      const [row] = (await db.execute(sql`select setting::int as ms from pg_settings where name = 'statement_timeout'`)).rows as { ms: number }[];
      expect(row.ms).toBe(8000);
      // The same rule with a short limit, so the test does not take 8 seconds.
      const stopped = await db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = 200`);
          await tx.execute(sql`select pg_sleep(2)`);
          return 'ran to the end';
        })
        .catch((error) => String((error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code));
      expect(stopped).toBe('57014');
    } finally {
      await pool.end();
    }
  });
});
