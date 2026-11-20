// No statement may run for more than 8 seconds. A slow database then shows up
// as an error the kiosk can report, not as a request that hangs.
//
// The driver asks for that limit when it connects (client.ts), and a Postgres
// you connect to directly honors it. A host's proxy can drop it on the way:
// Neon's does, on its pooled address and on its direct one, and the server
// then runs with no limit at all. Its pooled address also forgets a SET made
// on a connection. So the limit is stored in the database itself, as a
// default of the app's role there. That holds however a connection is made.
import { Client } from 'pg';

export const STATEMENT_LIMIT_MS = 8000;

/**
 * Stores the limit as a default of this role in this database. Safe to run
 * again. To take it back out:
 *   alter role <role> in database <database> reset statement_timeout;
 */
export async function storeStatementLimit(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Names cannot be parameters, so the server writes the statement itself and quotes them.
    const made = await client.query(
      "select format('alter role %I in database %I set statement_timeout = %L', current_user, current_database(), $1::text) as statement",
      [String(STATEMENT_LIMIT_MS)],
    );
    await client.query(made.rows[0].statement);
  } finally {
    await client.end();
  }
}

/**
 * What the server enforces on a new connection that asks for nothing, in
 * milliseconds, and where the server says the value comes from. 0 is no limit.
 * Asked of the server, never assumed. Through a pooler, a connection that was
 * already open before the limit was stored keeps its old answer until the
 * pooler closes it.
 */
export async function statementLimitInForce(url: string): Promise<{ ms: number; source: string }> {
  // Not makeDb: that asks for the limit at connect time, which is the thing being checked around.
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query("select setting::int as ms, source from pg_settings where name = 'statement_timeout'");
    return { ms: rows[0].ms, source: rows[0].source };
  } finally {
    await client.end();
  }
}
