// Starts one throwaway Postgres for the whole test run and builds a migrated
// template database. Each test file copies the template, which takes
// milliseconds, so files never see each other's rows.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { ensureDatabase, freePort, startLocalPostgres } from '../../lib/db/local';
import { migrateUrl } from '../../lib/db/migrate';

export default async function setup(project: TestProject) {
  const dir = join(mkdtempSync(join(tmpdir(), 'signin-test-pg-')), 'data');
  const pg = await startLocalPostgres({ dir, port: await freePort(), persistent: false, fresh: true });
  await ensureDatabase(pg.url('postgres'), 'template_app');
  await migrateUrl(pg.url('template_app'));
  project.provide('pgBase', pg.url(''));
  return async () => {
    await pg.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgBase: string;
  }
}
