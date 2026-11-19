import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { answer, body, json, kioskOr401 } from '@/lib/kiosk-api';
import { memberByScanCode } from '@/lib/members';
import { submitWork } from '@/lib/submit';
import { forKiosk, openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

// The two-tap "Done" on the kiosk. No note, no link. A task that needs a
// lead's check goes to a lead and the answer says so.
export function POST(request: Request) {
  return answer(async () => {
    const kiosk = await kioskOr401(request);
    if (kiosk instanceof Response) return kiosk;
    const { code, taskId, assignmentId } = await body(request);
    const db = getDb();
    const member = await memberByScanCode(db, code);
    if (!member || !isUuid(taskId)) return json({ status: 'unknown' });
    const today = chicagoDay(new Date());
    const { ok, state } = await submitWork(db, {
      taskId,
      assignmentId: isUuid(assignmentId) ? assignmentId : undefined,
      memberId: member.id,
      note: '',
      link: '',
      via: 'kiosk',
      today,
    });
    return json({ status: 'ok', changed: ok, state: state ?? null, tasks: forKiosk(await openFor(db, member.id, today)) });
  });
}
