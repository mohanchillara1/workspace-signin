import { getDb } from '@/lib/db/client';
import { isUuid } from '@/lib/ids';
import { photoOf } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

// An item's photo. The address holds the item's own long id, which only the
// inventory pages hand out, and the picture is of a part on a shelf.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = isUuid(id) ? await photoOf(getDb(), id) : null;
  if (!photo) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(photo.bytes), {
    // The page asks for a new address whenever the photo changes, so this copy can be kept.
    headers: { 'content-type': photo.mime, 'cache-control': 'private, max-age=31536000, immutable' },
  });
}
