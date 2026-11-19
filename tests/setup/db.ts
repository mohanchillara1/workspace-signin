import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';
import { makeDb } from '@/lib/db/client';

type Handle = ReturnType<typeof makeDb>;

/** Gives this test file its own migrated database. Call inside describe(). */
export function useTestDb(): () => Handle['db'] {
  let handle: Handle | undefined;
  beforeAll(async () => {
    const base = inject('pgBase');
    const name = `t_${randomBytes(6).toString('hex')}`;
    const admin = new Client({ connectionString: `${base}postgres` });
    await admin.connect();
    await admin.query(`create database "${name}" template template_app`);
    await admin.end();
    handle = makeDb(`${base}${name}`);
  });
  afterAll(async () => {
    await handle?.pool.end();
  });
  return () => {
    if (!handle) throw new Error('the test database is not ready yet');
    return handle.db;
  };
}
