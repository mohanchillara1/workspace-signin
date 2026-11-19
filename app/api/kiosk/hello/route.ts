import { refreshKioskCookie } from '@/lib/auth/session';
import { json, kioskOr401 } from '@/lib/kiosk-api';

export const dynamic = 'force-dynamic';

// The scan page calls this once when it opens. It keeps the pairing cookie
// from running out on a device that is used every week.
export async function POST(request: Request) {
  const kiosk = await kioskOr401(request);
  if (kiosk instanceof Response) return kiosk;
  await refreshKioskCookie();
  return json({ status: 'ok', name: kiosk.name });
}
