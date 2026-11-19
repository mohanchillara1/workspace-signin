import { getDb } from '@/lib/db/client';
import { body, json, kioskOr401 } from '@/lib/kiosk-api';
import { handleScan } from '@/lib/scan';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const kiosk = await kioskOr401(request);
  if (kiosk instanceof Response) return kiosk;
  const { code } = await body(request);
  const result = await handleScan(getDb(), { code, kioskId: kiosk.id, now: new Date() });
  if (result.status !== 'ok') return json(result);
  // The member's id stays on the server. The kiosk keeps the code it read.
  const { memberId: _memberId, ...rest } = result;
  return json(rest);
}
