import { chicagoDay } from '@/lib/day';
import { getDb } from '@/lib/db/client';
import { body, json, kioskOr401 } from '@/lib/kiosk-api';
import { memberByScanCode } from '@/lib/members';
import { claim, openFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

// "I'll take this" on the kiosk. The member is looked up again from the code.
export async function POST(request: Request) {
  const kiosk = await kioskOr401(request);
  if (kiosk instanceof Response) return kiosk;
  const { code, taskId } = await body(request);
  const db = getDb();
  const member = await memberByScanCode(db, code);
  if (!member || typeof taskId !== 'string') return json({ status: 'unknown' });
  const today = chicagoDay(new Date());
  const { ok } = await claim(db, { taskId, memberId: member.id, today });
  return json({ status: 'ok', changed: ok, tasks: await openFor(db, member.id, today) });
}
