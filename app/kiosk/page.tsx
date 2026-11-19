import type { Metadata } from 'next';
import { Kiosk } from '@/components/kiosk/Kiosk';
import { currentKiosk } from '@/lib/auth/session';
import { copy } from '@/lib/copy';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: copy.kiosk.idleTitle };

export default async function KioskPage() {
  const kiosk = await currentKiosk();
  if (!kiosk) {
    const k = copy.kiosk;
    return (
      <main className="flex min-h-dvh items-center justify-center p-8">
        <div className="max-w-xl">
          <h1 className="text-5xl">{k.notPairedTitle}</h1>
          <p className="mt-4 text-xl text-paper/85">{k.notPairedBody}</p>
          <a href="/login" className="btn-pill mt-8 bg-arcade-fuel text-ink">
            {k.notPairedLink}
          </a>
        </div>
      </main>
    );
  }
  const idle = Number(process.env.KIOSK_IDLE_SECONDS);
  // The test feed is a stand-in for the camera. It is never on in production.
  const testFeed = process.env.KIOSK_TEST_FEED === '1' && process.env.VERCEL_ENV !== 'production';
  return (
    <Kiosk
      idleSeconds={Number.isFinite(idle) && idle >= 2 && idle <= 120 ? idle : 15}
      testFeed={testFeed}
      kioskName={kiosk.name}
    />
  );
}
