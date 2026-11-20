// Brings the database in DATABASE_URL up to the newest migration.
import { migrateUrl } from '../lib/db/migrate';
import { databaseUrl, describeDatabase } from './env';

const url = databaseUrl();
migrateUrl(url)
  .then(() => console.log(`The database (${describeDatabase(url)}) is up to date.`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
