import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { answer, body, json, kioskOr401 } from '@/lib/kiosk-api';
import { memberByScanCode } from '@/lib/members';
import { giveBack, openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

// "Put it back" on the kiosk: a member returns a pool task they took.
export function POST(request: Request) {
  return answer(async () => {
    const kiosk = await kioskOr401(request);
    if (kiosk instanceof Response) return kiosk;
    const { code, assignmentId } = await body(request);
    const db = getDb();
    const member = await memberByScanCode(db, code);
    if (!member || !isUuid(assignmentId)) return json({ status: 'unknown' });
    const { ok } = await giveBack(db, { assignmentId, memberId: member.id });
    return json({ status: 'ok', changed: ok, tasks: await openFor(db, member.id, chicagoDay(new Date())) });
  });
}
