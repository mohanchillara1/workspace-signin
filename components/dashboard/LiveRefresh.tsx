'use client';

// Asks the server for the page again every few seconds while it is on screen,
// so a scan at the kiosk shows up without a reload. It stops after three hours
// with no tap or key, so a page left open on a laptop does not keep the
// database awake all night; any tap starts it again.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { copy } from '@/lib/copy';

const PAUSE_AFTER_MS = 3 * 60 * 60 * 1000;

export function LiveRefresh({ seconds, updated }: { seconds: number; updated: string }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const lastTouch = useRef(Date.now());

  useEffect(() => {
    const touch = () => {
      lastTouch.current = Date.now();
      setPaused(false);
    };
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastTouch.current > PAUSE_AFTER_MS) {
        setPaused(true);
        return;
      }
      router.refresh();
    };
    // Coming back to the tab brings it up to date at once.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const timer = setInterval(tick, seconds * 1000);
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router, seconds]);

  const a = copy.attendance;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-paper/60">
      <span className={`inline-block h-2 w-2 rounded-full ${paused ? 'bg-paper/30' : 'bg-arcade-mint'}`} aria-hidden="true" />
      {paused ? a.graphPaused : a.graphLive(updated)}
      {paused && (
        <button type="button" className="btn-small" onClick={() => router.refresh()}>
          {a.graphResume}
        </button>
      )}
    </p>
  );
}
