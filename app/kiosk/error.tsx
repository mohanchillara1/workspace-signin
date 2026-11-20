'use client';

import { useEffect } from 'react';
import { copy } from '@/lib/copy';

// How long the message stays up before the first try to reload.
const WAIT_MS = 10_000;

/**
 * Shown if the scan screen itself breaks. Nobody is standing by to press a
 * button on a wall, so it reloads by itself. It asks the server first: a
 * reload with no connection would leave a browser error page instead.
 */
export default function KioskError() {
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started < WAIT_MS) return;
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (response.ok) window.location.reload();
      } catch {
        // No connection yet. Try again on the next turn.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const k = copy.kiosk;
  return (
    <main data-testid="kiosk-error" className="flex min-h-dvh items-center justify-center p-8">
      <div className="max-w-xl">
        <h1 className="text-5xl">{k.crashTitle}</h1>
        <p className="mt-4 text-xl text-paper/85">{k.crashBody}</p>
      </div>
    </main>
  );
}
