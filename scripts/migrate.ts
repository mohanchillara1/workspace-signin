// Brings the database in DATABASE_URL up to the newest migration.
import { migrateUrl } from '../lib/db/migrate';
import { databaseUrl } from './env';

migrateUrl(databaseUrl())
  .then(() => console.log('The database is up to date.'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
