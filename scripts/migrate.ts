// Brings the database in DATABASE_URL up to the newest migration, and stores
// the 8-second statement limit in it (lib/db/limit.ts). Then it asks the
// server whether a new connection gets that limit, and says what it heard.
import { STATEMENT_LIMIT_MS, statementLimitInForce } from '../lib/db/limit';
import { migrateUrl } from '../lib/db/migrate';
import { databaseUrl, describeDatabase } from './env';

const url = databaseUrl();
migrateUrl(url)
  .then(async () => {
    console.log(`The database (${describeDatabase(url)}) is up to date.`);
    const limit = await statementLimitInForce(url);
    console.log(
      limit.ms === STATEMENT_LIMIT_MS
        ? `A new connection is held to ${limit.ms} ms a statement.`
        : `The statement limit is stored, but a new connection reports ${limit.ms} ms. Through a pooler, connections that were already open keep the old value until they close. Check again: npm run db:limit`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
