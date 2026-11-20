import type { Metadata } from 'next';
import { Kiosk } from '@/components/kiosk/Kiosk';
import { currentKiosk } from '@/lib/auth/session';
import { BUILD } from '@/lib/build';
import { copy } from '@/lib/copy';
import { kioskDimMinutes } from '@/lib/kiosk-wall';
import { isTestCopy } from '@/lib/test-copy';

export const dynamic = 'force-dynamic';
// The manifest and the touch icon are on this page only, paired or not: a
// lead adds it to the iPad's Home Screen first and pairs it from inside that
// app. The older Apple tag is spelled out for iPads that do not read the manifest.
export const metadata: Metadata = {
  title: copy.kiosk.idleTitle,
  manifest: '/kiosk/manifest.webmanifest',
  icons: { apple: [{ url: '/icons/kiosk-180.png', sizes: '180x180', type: 'image/png' }] },
  appleWebApp: { capable: true, title: copy.kiosk.homeScreenShortName, statusBarStyle: 'black-translucent' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

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
      testCopy={isTestCopy()}
      build={BUILD}
      dimAfterSeconds={kioskDimMinutes() * 60}
    />
  );
}
