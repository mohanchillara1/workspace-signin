// A home-screen manifest made for one member, so the icon opens their own page.
// iPhones use the page address instead; this is for Android.
import { copy } from '@/lib/copy';
import { getDb } from '@/lib/db/client';
import { memberByPageKey } from '@/lib/members';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const member = await memberByPageKey(getDb(), key);
  if (!member) return new Response('Not found', { status: 404 });
  const page = `/m/${key}`;
  const manifest = {
    name: copy.member.homeScreenName,
    short_name: copy.member.homeScreenName,
    id: page,
    start_url: page,
    scope: page,
    display: 'standalone',
    background_color: '#050507',
    theme_color: '#050507',
    icons: [
      { src: '/home-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/home-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' },
  });
}
