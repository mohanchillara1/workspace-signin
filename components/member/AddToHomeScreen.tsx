'use client';

import { useEffect, useState } from 'react';
import { copy } from '@/lib/copy';

type Device = 'iphone' | 'android' | 'other';
type InstallPrompt = Event & { prompt: () => unknown };

/**
 * Steps for putting this page on the phone's home screen, so the QR code is
 * one tap away. Hidden once the page is already opened from the home screen.
 */
export function AddToHomeScreen() {
  const [device, setDevice] = useState<Device | null>(null);
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const h = copy.member.homeScreen;

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    // iPads say "Macintosh" but have a touch screen.
    const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    setDevice(apple ? 'iphone' : /Android/.test(ua) ? 'android' : 'other');
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (installed || device === null) return null;
  const steps = device === 'android' ? h.androidSteps : h.iphoneSteps;

  return (
    <details data-testid="home-screen" className="mt-5 w-full rounded-xl border-2 border-arcade-fuel/70 bg-deep p-4" open={device !== 'other'}>
      <summary className="cursor-pointer font-display text-xl">{h.title}</summary>
      <p className="mt-2 text-sm text-paper/80">{h.why}</p>
      {prompt ? (
        <button
          type="button"
          className="btn-pill mt-3 bg-arcade-fuel text-ink"
          onClick={async () => {
            await prompt.prompt();
            setPrompt(null);
          }}
        >
          {h.androidButton}
        </button>
      ) : (
        <>
          {device === 'other' && <p className="mt-2 text-sm text-paper/80">{h.otherNote}</p>}
          {device === 'other' && <p className="mt-3 text-sm font-bold">{h.iphoneLabel}</p>}
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-base">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {device === 'other' && (
            <>
              <p className="mt-3 text-sm font-bold">{h.androidLabel}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-base">
                {h.androidSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <p className="mt-3 text-sm text-paper/70">{h.after}</p>
    </details>
  );
}
