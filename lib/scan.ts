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
  deps: { loadTasks?: typeof openFor; count?: typeof hit } = {},
): Promise<ScanResult> {
  const kiosk = input.kioskId ?? 'none';
  const count = deps.count ?? hit;
  // The limiter keeps a broken or hostile kiosk from hammering the database.
  // If the limiter itself fails, the scan goes ahead: a counting fault must
  // never cost someone their sign-in.
  const allowed = async (key: string, limit: number) => {
    try {
      return (await count(db, { key, limit, windowSeconds: 60, now: input.now })).allowed;
    } catch (error) {
      console.error('The scan limiter failed. Letting the scan through.', error);
      return true;
    }
  };
  if (!(await allowed(`scan:${kiosk}`, SCANS_A_MINUTE))) return { status: 'slow_down' };

  const member = await memberByScanCode(db, input.code);
  if (!member) {
    return (await allowed(`scan-unknown:${kiosk}`, UNKNOWN_A_MINUTE)) ? { status: 'unknown' } : { status: 'slow_down' };
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
