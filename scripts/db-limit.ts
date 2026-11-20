// Asks the database in DATABASE_URL what statement limit it puts on a new
// connection that asks for none. Read-only. Exits 1 when it is not 8 seconds.
//   DATABASE_URL=... npm run db:limit
//   DATABASE_URL=... npm run db:limit -- --slow     also runs a 9-second statement and times it
// Asking is the only way to know: a host's proxy can drop the limit the app
// asks for when it connects, and nothing fails when it does.
import { Client } from 'pg';
import { STATEMENT_LIMIT_MS, statementLimitInForce } from '../lib/db/limit';
import { databaseUrl, describeDatabase } from './env';

async function main() {
  const url = databaseUrl();
  const limit = await statementLimitInForce(url);
  const right = limit.ms === STATEMENT_LIMIT_MS;
  console.log(`The database (${describeDatabase(url)}) holds a new connection to ${limit.ms} ms a statement (the server gives its source as "${limit.source}").`);
  if (!right) console.log(`That should be ${STATEMENT_LIMIT_MS}. Store it with: npm run db:migrate`);
  let stopped = true;
  if (process.argv.includes('--slow')) {
    // A plain connection again, with no limit of its own and no driver timeout.
    const client = new Client({ connectionString: url });
    await client.connect();
    const started = Date.now();
    try {
      await client.query('select pg_sleep(9)');
      stopped = false;
      console.log(`A 9-second statement ran to the end in ${Date.now() - started} ms. The server did not stop it.`);
    } catch (error) {
      const code = (error as { code?: string }).code;
      stopped = code === '57014';
      console.log(`A 9-second statement was stopped after ${Date.now() - started} ms (code ${code ?? 'none'}${stopped ? ', the statement limit' : ''}).`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  if (!right || !stopped) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
