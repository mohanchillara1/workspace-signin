import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { body, json, kioskOr401 } from '@/lib/kiosk-api';
import { memberByScanCode } from '@/lib/members';
import { markDone, openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

// The plain "Done" tap on the kiosk.
export async function POST(request: Request) {
  const kiosk = await kioskOr401(request);
  if (kiosk instanceof Response) return kiosk;
  const { code, taskId, assignmentId } = await body(request);
  const db = getDb();
  const member = await memberByScanCode(db, code);
  if (!member || typeof taskId !== 'string') return json({ status: 'unknown' });
  const today = chicagoDay(new Date());
  const { ok } = await markDone(db, {
    taskId,
    assignmentId: typeof assignmentId === 'string' ? assignmentId : undefined,
    memberId: member.id,
    via: 'kiosk',
    today,
  });
  return json({ status: 'ok', changed: ok, tasks: await openFor(db, member.id, today) });
}
