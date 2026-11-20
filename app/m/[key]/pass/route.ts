// GET /m/<page key>/pass?platform=apple|google
// Sends the member a wallet pass: a file for Apple, a redirect to the service's
// own Google link for Google. The logic is in lib/wallet.ts.
import { clientAddress } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { servePass } from '@/lib/wallet';

export const dynamic = 'force-dynamic';

const plain = (text: string, status: number) =>
  new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const platform = new URL(request.url).searchParams.get('platform');
  const answer = await servePass(getDb(), { key, platform, address: await clientAddress(), now: new Date() });
  if (answer.status === 404) return plain('Not found', 404);
  if (answer.status !== 200) return plain(answer.message, answer.status);
  const { made } = answer;
  if (made.kind === 'link') {
    return new Response(null, { status: 302, headers: { location: made.url, 'cache-control': 'no-store' } });
  }
  return new Response(Buffer.from(made.bytes), {
    status: 200,
    headers: {
      'content-type': made.contentType,
      'content-disposition': `attachment; filename="${made.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
