// The kiosk asks this to find out whether it is online. It says nothing else.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
