import { recordScan } from './attendance';
import type { Db } from './db/client';
import { memberByScanCode } from './members';
import { shortName } from './names';
import { hit } from './rate-limit';
import { openFor, type Handout } from './tasks';

export type ScanResult =
  | {
      status: 'ok';
      memberId: string;
      firstName: string;
      name: string;
      firstToday: boolean;
      day: string;
      /** null when the tasks could not be loaded. The sign-in still counted. */
      tasks: Handout[] | null;
    }
  | { status: 'unknown' }
  | { status: 'slow_down' };

const SCANS_A_MINUTE = 60;
const UNKNOWN_A_MINUTE = 10;

/**
 * What happens when the kiosk reads a code.
 *
 * Attendance is written first and on its own. Only after that row is safely
 * in the database does the task side run, inside its own try, so a fault
 * there can never cost someone their sign-in.
 */
export async function handleScan(
  db: Db,
  input: { code: unknown; kioskId: string | null; now: Date },
  deps: { loadTasks?: typeof openFor } = {},
): Promise<ScanResult> {
  const kiosk = input.kioskId ?? 'none';
  const within = await hit(db, { key: `scan:${kiosk}`, limit: SCANS_A_MINUTE, windowSeconds: 60, now: input.now });
  if (!within.allowed) return { status: 'slow_down' };

  const member = await memberByScanCode(db, input.code);
  if (!member) {
    const guesses = await hit(db, {
      key: `scan-unknown:${kiosk}`,
      limit: UNKNOWN_A_MINUTE,
      windowSeconds: 60,
      now: input.now,
    });
    return guesses.allowed ? { status: 'unknown' } : { status: 'slow_down' };
  }

  const { day, firstToday } = await recordScan(db, { memberId: member.id, at: input.now, kioskId: input.kioskId });

  let tasks: Handout[] | null = null;
  try {
    tasks = await (deps.loadTasks ?? openFor)(db, member.id, day);
  } catch (error) {
    console.error('Tasks did not load after a scan. The sign-in was recorded.', error);
  }

  return {
    status: 'ok',
    memberId: member.id,
    firstName: member.firstName,
    name: shortName(member.firstName, member.lastName),
    firstToday,
    day,
    tasks,
  };
}
