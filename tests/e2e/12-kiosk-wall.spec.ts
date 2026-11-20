// The kiosk as a device that sits on a wall for weeks: installable to the
// Home Screen, awake, dim when quiet, and back by itself after trouble.
// What only a real iPad can prove is listed in the README.
import { expect, test, type Page } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addMember } from '@/lib/members';
import { closeDb, db, feed, logIn, pairByCookie, watchConsole } from './helpers';

const k = copy.kiosk;
test.afterAll(closeDb);

const kiosk = (page: Page) => page.getByTestId('kiosk');

test('the scan page can be put on the Home Screen: a manifest, touch icons, full screen', async ({ page, context, request }) => {
  await pairByCookie(context, 'Wall manifest kiosk');
  await page.goto('/kiosk');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/kiosk/manifest.webmanifest');
  const manifestResponse = await request.get(manifestHref!);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe('/kiosk');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const picture = await request.get(icon.src);
    expect(picture.status()).toBe(200);
    expect(picture.headers()['content-type']).toBe('image/png');
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touch).toContain('/icons/kiosk-180.png');
  expect((await request.get(touch!)).status()).toBe(200);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});

test('the scan page still has an ordinary icon, paired or not, so the browser does not go looking for one that is not there', async ({ page, context, request }) => {
  // Giving this page its own touch icon must not take the app's icon away from it.
  // With no icon named, a browser asks for /favicon.ico, which this app does not have.
  const iconIsThere = async () => {
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const picture = await request.get(href!);
    expect(picture.status()).toBe(200);
    expect(picture.headers()['content-type']).toContain('image/');
  };
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: k.notPairedTitle })).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).not.toHaveCount(0);
  await iconIsThere();
  await pairByCookie(context, 'Wall icon kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  await expect(page.locator('link[rel="icon"]')).not.toHaveCount(0);
  await iconIsThere();
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("a member's page and the login page do not carry the kiosk's manifest", async ({ page }) => {
  // Otherwise a member who adds their own page to their Home Screen would get the scan page.
  const member = await addMember(db(), { firstName: 'Shortcut', lastName: 'Person' }, null);
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  // The member page has a manifest of its own, which opens that member's page.
  await page.goto(`/m/${member.pageKey}`);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe(`/m/${member.pageKey}/manifest.webmanifest`);
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest.start_url).toBe(`/m/${member.pageKey}`);
});

// A stand-in for the browser's screen wake lock that records what the page asks for.
const fakeWakeLock = (mode: 'works' | 'refuses') => `
  window.__wake = { asked: 0, held: 0 };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
    request: async (type) => {
      window.__wake.asked += 1;
      window.__wake.type = type;
      if (${JSON.stringify(mode)} === 'refuses') throw new DOMException('not allowed', 'NotAllowedError');
      const lock = new EventTarget();
      lock.released = false;
      lock.release = async () => { lock.released = true; window.__wake.held -= 1; lock.dispatchEvent(new Event('release')); };
      window.__wake.held += 1;
      window.__wake.last = lock;
      return lock;
    },
  } });
`;

test('the kiosk asks the browser to keep the screen on, and asks again when it loses the lock', async ({ page, context }) => {
  await context.addInitScript(fakeWakeLock('works'));
  await pairByCookie(context, 'Wall awake kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-wake', 'on');
  expect(await page.evaluate(() => (window as never as { __wake: { type: string } }).__wake.type)).toBe('screen');
  await expect(page.getByTestId('kiosk-wake')).toHaveCount(0);

  // The browser takes the lock away (the iPad was locked, say). The kiosk says so and gets it back.
  await page.evaluate(() => (window as never as { __wake: { last: { release(): Promise<void> } } }).__wake.last.release());
  await expect(kiosk(page)).toHaveAttribute('data-wake', 'off');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(kiosk(page)).toHaveAttribute('data-wake', 'on');
  expect(await page.evaluate(() => (window as never as { __wake: { asked: number } }).__wake.asked)).toBe(2);
});

test('when the browser will not keep the screen on, the kiosk still works and says what to set', async ({ page, context }) => {
  const errors = watchConsole(page);
  await context.addInitScript(fakeWakeLock('refuses'));
  const member = await addMember(db(), { firstName: 'Sleepy', lastName: 'Screen' }, null);
  await pairByCookie(context, 'Wall sleepy kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-wake', 'off');
  await expect(page.getByTestId('kiosk-wake')).toHaveText(k.wakeOff);
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Sleepy') })).toBeVisible();
  expect(errors).toEqual([]);
});

test('after a quiet hour the kiosk dims but still says "Scan your code"; a scan or a touch brings it back', async ({ page, context }) => {
  const member = await addMember(db(), { firstName: 'Dim', lastName: 'Waker' }, null);
  await page.clock.install();
  await pairByCookie(context, 'Wall dim kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  await expect(kiosk(page)).toHaveAttribute('data-dim', '0');
  await page.clock.fastForward('59:00');
  await expect(kiosk(page)).toHaveAttribute('data-dim', '0');
  await page.clock.fastForward('02:00');
  await expect(kiosk(page)).toHaveAttribute('data-dim', '1');
  const heading = page.getByRole('heading', { name: k.idleTitle });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport();

  // A touch wakes it.
  await kiosk(page).click({ position: { x: 20, y: 20 } });
  await expect(kiosk(page)).toHaveAttribute('data-dim', '0');

  // Quiet again, then a scan wakes it and signs the member in as usual.
  await page.clock.fastForward('01:01:00');
  await expect(kiosk(page)).toHaveAttribute('data-dim', '1');
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Dim') })).toBeVisible();
  await expect(kiosk(page)).toHaveAttribute('data-dim', '0');
});

test('after the site is updated, an idle kiosk reloads itself once', async ({ page, context }) => {
  await page.clock.install();
  await pairByCookie(context, 'Wall update kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  const build = await kiosk(page).getAttribute('data-build');
  expect(build).toBeTruthy();
  const health = await (await page.request.get('/api/health')).json();
  expect(health).toEqual({ ok: true, build });

  // Nothing new: no reload.
  let loads = 0;
  page.on('load', () => (loads += 1));
  await page.clock.fastForward('02:05');
  await page.waitForTimeout(300);
  expect(loads).toBe(0);

  // The site now reports a newer build.
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, build: 'a-newer-build' } }));
  await page.clock.fastForward('01:05');
  await expect.poll(() => loads).toBe(1);
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  // Still disagreeing a minute later: it does not reload in a loop.
  await page.clock.fastForward('02:05');
  await page.waitForTimeout(300);
  expect(loads).toBe(1);
});

test('if the scan screen itself breaks, it says so and comes back without anyone touching it', async ({ page, context }) => {
  await page.clock.install();
  const member = await addMember(db(), { firstName: 'After', lastName: 'Crash' }, null);
  await pairByCookie(context, 'Wall crash kiosk');
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  // A test-only door, open only on the test server: makes the screen throw.
  await page.evaluate(() => window.dispatchEvent(new Event('kiosk:test-crash')));
  await expect(page.getByTestId('kiosk-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: k.crashTitle })).toBeVisible();
  await page.clock.fastForward('00:20');
  await expect(kiosk(page)).toHaveAttribute('data-ready', '1');
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('After') })).toBeVisible();
});

for (const [label, viewport] of [
  ['a wide screen', { width: 1440, height: 900 }],
  ['a phone', { width: 390, height: 844 }],
] as const) {
  test(`the leads' Kiosk page gives the iPad set-up steps, on ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await logIn(page);
    await page.goto('/dashboard/kiosk');
    const c = copy.kioskAdmin;
    await expect(page.getByRole('heading', { name: c.setupTitle })).toBeVisible();
    for (const step of c.setup) await expect(page.getByText(step)).toBeVisible();
    await expect(page.getByRole('heading', { name: c.byItselfTitle })).toBeVisible();
    for (const line of c.byItself(60)) await expect(page.getByText(line)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
}
