// Puts the starter list on the inventory: a first guess at what an FRC team
// has, with every count empty.
//   npm run inventory-starter
// It adds only what is not on the list yet (any letter case) and changes
// nothing that is, so it is safe to run again. Then a lead sets aside what
// the team does not have, on the Inventory screen.
//
// A database that is not on this machine needs --hosted.
import { makeDb } from '../lib/db/client';
import { addStarterList, listInventory } from '../lib/inventory';
import { STARTER_LIST } from '../lib/inventory-starter';
import { databaseUrl, describeDatabase, isLocal } from './env';

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--hosted');
  if (unknown.length) throw new Error(`Unknown option ${unknown[0]}.`);
  const url = databaseUrl();
  if (!isLocal(url) && !args.includes('--hosted')) throw new Error('Refusing: DATABASE_URL does not point at this machine. Add --hosted if that is what you mean.');
  const { db, pool } = makeDb(url);
  try {
    const read = async () => {
      const all = await listInventory(db);
      return `${all.length} items, ${all.filter((item) => !item.have).length} set aside, ${all.filter((item) => item.count !== null).length} counted`;
    };
    console.log(`The starter list: ${STARTER_LIST.length} items. The database (${describeDatabase(url)}) before: ${await read()}.`);
    const result = await addStarterList(db, null);
    console.log(`Added: ${result.added}. Already there: ${result.already}. The database after: ${await read()}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  const plain = error instanceof Error && !('query' in error) && !('cause' in error && error.cause);
  console.error(plain ? (error as Error).message : `It stopped and nothing was added (database error, ${(error as { cause?: { code?: string } })?.cause?.code ?? 'no code'}).`);
  process.exit(1);
});
