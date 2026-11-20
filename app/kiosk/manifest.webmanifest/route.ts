import { kioskManifest } from '@/lib/kiosk-wall';

// Linked from the scan page only. A member who adds their own page to their
// Home Screen must get their page, not the kiosk.
export function GET() {
  return new Response(JSON.stringify(kioskManifest()), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
