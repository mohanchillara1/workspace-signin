import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { copy } from '@/lib/copy';
import { DIM_BRIGHTNESS, dimShift, kioskManifest, RELOAD_GAP_MS, shouldDim, shouldReload } from '@/lib/kiosk-wall';

const HOUR = 60 * 60 * 1000;

describe('the kiosk as a Home Screen app', () => {
  it('the manifest opens the scan page with no browser bars', () => {
    const manifest = kioskManifest();
    expect(manifest.start_url).toBe('/kiosk');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe(copy.kiosk.homeScreenName);
    expect(manifest.background_color).toBe('#050507');
    expect(manifest.icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons) expect(icon.type).toBe('image/png');
  });

  it('the icons on disk are the sizes they claim, with no see-through pixels', () => {
    for (const size of [180, 192, 512]) {
      const png = PNG.sync.read(readFileSync(`public/icons/kiosk-${size}.png`));
      expect([png.width, png.height]).toEqual([size, size]);
      // A touch icon with a see-through corner gets a black or white fill the page did not choose.
      for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [size >> 1, size >> 1]]) {
        expect(png.data[(y * size + x) * 4 + 3]).toBe(255);
      }
    }
  });
});

describe('when the kiosk reloads itself', () => {
  const base = { healthOk: true, serverBuild: 'new', ownBuild: 'old', phase: 'idle', lastReloadAt: 0, now: 10 * HOUR };

  it('reloads when the site has a newer build and nobody is using it', () => {
    expect(shouldReload(base)).toBe(true);
  });

  it('stays put on the same build, with no build known, or when the site cannot be reached', () => {
    expect(shouldReload({ ...base, serverBuild: 'old' })).toBe(false);
    expect(shouldReload({ ...base, serverBuild: '' })).toBe(false);
    expect(shouldReload({ ...base, ownBuild: '' })).toBe(false);
    // Reloading with no connection would leave a browser error page on the wall.
    expect(shouldReload({ ...base, healthOk: false })).toBe(false);
  });

  it('never reloads under someone who is signing in or reading their tasks', () => {
    for (const phase of ['loading', 'hello', 'unknown', 'slow', 'error', 'offline']) {
      expect(shouldReload({ ...base, phase })).toBe(false);
    }
  });

  it('does not reload again and again if the builds keep disagreeing', () => {
    expect(shouldReload({ ...base, lastReloadAt: base.now - RELOAD_GAP_MS + 1000 })).toBe(false);
    expect(shouldReload({ ...base, lastReloadAt: base.now - RELOAD_GAP_MS - 1000 })).toBe(true);
  });
});

describe('dimming after a quiet hour', () => {
  it('dims only the idle screen, and only after the quiet time', () => {
    expect(shouldDim({ phase: 'idle', quietForMs: HOUR + 1, dimAfterMs: HOUR })).toBe(true);
    expect(shouldDim({ phase: 'idle', quietForMs: HOUR - 1, dimAfterMs: HOUR })).toBe(false);
    for (const phase of ['loading', 'hello', 'unknown', 'slow', 'error', 'offline']) {
      expect(shouldDim({ phase, quietForMs: 5 * HOUR, dimAfterMs: HOUR })).toBe(false);
    }
  });

  it('a dim time of zero turns dimming off', () => {
    expect(shouldDim({ phase: 'idle', quietForMs: 99 * HOUR, dimAfterMs: 0 })).toBe(false);
  });

  it('dim is dimmer, not dark: the words can still be read', () => {
    expect(DIM_BRIGHTNESS).toBeGreaterThanOrEqual(0.25);
    expect(DIM_BRIGHTNESS).toBeLessThan(1);
  });

  it('while dim the words move a few pixels now and then, so they do not sit on the same spot for weeks', () => {
    const spots = new Set<string>();
    for (let minute = 0; minute < 40; minute += 2) {
      const { x, y } = dimShift(minute * 60_000);
      expect(Math.abs(x)).toBeLessThanOrEqual(16);
      expect(Math.abs(y)).toBeLessThanOrEqual(16);
      spots.add(`${x},${y}`);
    }
    expect(spots.size).toBeGreaterThanOrEqual(4);
  });
});

describe("the leads' set-up steps", () => {
  it('cover the Home Screen, the pairing, the camera, Auto-Lock and Guided Access', () => {
    const steps = copy.kioskAdmin.setup.join(' ');
    for (const word of ['Add to Home Screen', 'Make this the kiosk', 'camera', 'Auto-Lock', 'Never', 'Guided Access', 'charger']) {
      expect(steps).toContain(word);
    }
    expect(copy.kioskAdmin.byItself(60).join(' ')).toMatch(/hour/);
    expect(copy.kioskAdmin.byItself(20).join(' ')).toMatch(/20 minutes/);
  });
});
