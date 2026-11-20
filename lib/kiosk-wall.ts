// The rules that let the kiosk sit on a wall for weeks. They are plain
// functions so they can be tested without a browser; components/kiosk/Kiosk.tsx
// calls them.
import { copy } from './copy';

/** What the iPad needs to put the scan page on its Home Screen as a full-screen app. */
export function kioskManifest() {
  return {
    name: copy.kiosk.homeScreenName,
    short_name: copy.kiosk.homeScreenShortName,
    // Scope is the whole site, so logging in to pair the device stays inside the app.
    start_url: '/kiosk',
    scope: '/',
    display: 'standalone' as const,
    background_color: '#050507',
    theme_color: '#050507',
    icons: [
      { src: '/icons/kiosk-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/kiosk-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

/** The least time between two reloads the kiosk does by itself. */
export const RELOAD_GAP_MS = 5 * 60 * 1000;

/**
 * Whether an idle kiosk should reload to pick up a newer build of the site.
 * Only when the site answered (a reload with no connection would leave a
 * browser error page on the wall), only when nobody is using the screen, and
 * not again within a few minutes if the builds keep disagreeing.
 */
export function shouldReload(input: {
  healthOk: boolean;
  serverBuild: string;
  ownBuild: string;
  phase: string;
  lastReloadAt: number;
  now: number;
}): boolean {
  if (!input.healthOk || !input.serverBuild || !input.ownBuild) return false;
  if (input.serverBuild === input.ownBuild) return false;
  if (input.phase !== 'idle') return false;
  return input.now - input.lastReloadAt >= RELOAD_GAP_MS;
}

/** Minutes with no scan and no touch before the idle screen dims. KIOSK_DIM_MINUTES; 0 turns it off. */
export function kioskDimMinutes(): number {
  const raw = process.env.KIOSK_DIM_MINUTES;
  const minutes = raw === undefined || raw.trim() === '' ? 60 : Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? Math.floor(minutes) : 60;
}

/** How bright the dimmed screen is: low, but "Scan your code" can still be read. */
export const DIM_BRIGHTNESS = 0.3;

/** Whether the idle screen should be dim. A dim time of zero turns dimming off. */
export function shouldDim(input: { phase: string; quietForMs: number; dimAfterMs: number }): boolean {
  return input.dimAfterMs > 0 && input.phase === 'idle' && input.quietForMs >= input.dimAfterMs;
}

const SHIFTS = [
  { x: 0, y: 0 },
  { x: 12, y: -8 },
  { x: -10, y: 10 },
  { x: 8, y: 12 },
  { x: -12, y: -10 },
];

/** While dim, the words move a few pixels every two minutes, so they do not rest on one spot for weeks. */
export function dimShift(nowMs: number): { x: number; y: number } {
  return SHIFTS[Math.floor(nowMs / 120_000) % SHIFTS.length];
}
