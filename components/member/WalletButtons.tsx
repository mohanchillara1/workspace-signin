import { copy } from '@/lib/copy';
import type { Platform } from '@/lib/wallet';

/**
 * "Add to Apple Wallet" and "Add to Google Wallet", as plain links to the pass
 * route. The page decides which platforms to pass in; with none, nothing shows.
 * These are plain buttons in the app's style, not Apple's or Google's badges.
 */
export function WalletButtons({ pageKey, platforms }: { pageKey: string; platforms: Platform[] }) {
  if (platforms.length === 0) return null;
  const w = copy.wallet;
  const label: Record<Platform, string> = { apple: w.apple, google: w.google };
  return (
    <section data-testid="wallet" aria-labelledby="wallet-title" className="mt-8">
      <h2 id="wallet-title" className="text-2xl">{w.title}</h2>
      <p className="mt-2 text-base text-paper/85">{w.body}</p>
      <div className="mt-4 flex flex-col gap-3">
        {platforms.map((platform) => (
          <a
            key={platform}
            data-testid={`wallet-${platform}`}
            href={`/m/${pageKey}/pass?platform=${platform}`}
            className="btn-pill w-full !whitespace-normal text-center"
          >
            {label[platform]}
          </a>
        ))}
      </div>
    </section>
  );
}
