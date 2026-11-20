import { expect, test } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addMember, setActive } from '@/lib/members';
import { closeDb, db, logIn, watchConsole } from './helpers';

// The test server runs with WALLET_STAND_IN=1 (scripts/e2e-server.ts), so no
// service is called and no key exists. The stand-in makes a small made-up file.
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.afterAll(closeDb);

const w = copy.wallet;
let n = 0;
/** A different caller address for each test, so the per-address limit never crosses tests. */
const asCaller = () => ({ 'x-forwarded-for': `10.20.30.${++n}` });

test('a member sees both buttons on a phone, with no sideways scroll, and the pass route answers', async ({ page, request }) => {
  const errors = watchConsole(page);
  const member = await addMember(db(), { firstName: 'Walleta', lastName: 'Lastname-Test' }, null);
  await page.setExtraHTTPHeaders(asCaller());

  await page.goto(`/m/${member.pageKey}`);
  await expect(page.getByRole('heading', { name: w.title })).toBeVisible();
  const apple = page.getByRole('link', { name: w.apple });
  const google = page.getByRole('link', { name: w.google });
  await expect(apple).toBeVisible();
  await expect(google).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Both buttons sit inside the phone's width.
  for (const button of [apple, google]) {
    const box = await button.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await expect(apple).toHaveAttribute('href', `/m/${member.pageKey}/pass?platform=apple`);

  // Apple: a file, to download, never cached.
  const file = await request.get(`/m/${member.pageKey}/pass?platform=apple`, { headers: asCaller() });
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/vnd.apple.pkpass');
  expect(file.headers()['content-disposition']).toMatch(/^attachment; filename="[^"]+\.pkpass"$/);
  expect(file.headers()['cache-control']).toBe('no-store');
  expect((await file.body()).length).toBeGreaterThan(0);

  // Google: a redirect to the documented host. The stand-in link is not followed.
  const link = await request.get(`/m/${member.pageKey}/pass?platform=google`, { headers: asCaller(), maxRedirects: 0 });
  expect(link.status()).toBe(302);
  expect(link.headers()['location']).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
  expect(link.headers()['cache-control']).toBe('no-store');

  expect(errors).toEqual([]);
});

test('a wrong key, an inactive member and an unknown platform all get a 404', async ({ request }) => {
  const member = await addMember(db(), { firstName: 'Walletb' }, null);
  const gone = await addMember(db(), { firstName: 'Walletc' }, null);
  await setActive(db(), gone.id, false, null);
  const get = (path: string) => request.get(path, { headers: asCaller(), maxRedirects: 0 });
  expect((await get(`/m/${'A'.repeat(32)}/pass?platform=apple`)).status()).toBe(404);
  expect((await get(`/m/short/pass?platform=apple`)).status()).toBe(404);
  expect((await get(`/m/${gone.pageKey}/pass?platform=apple`)).status()).toBe(404);
  expect((await get(`/m/${member.pageKey}/pass?platform=windows`)).status()).toBe(404);
  expect((await get(`/m/${member.pageKey}/pass`)).status()).toBe(404);
});

test('one address is limited, and the limit is plain words', async ({ request }) => {
  const member = await addMember(db(), { firstName: 'Walletd' }, null);
  const headers = asCaller();
  const statuses: number[] = [];
  let last = '';
  for (let i = 0; i < 12; i++) {
    const response = await request.get(`/m/${member.pageKey}/pass?platform=apple`, { headers });
    statuses.push(response.status());
    last = await response.text();
  }
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses.slice(10)).toEqual([429, 429]);
  expect(last).toBe(w.tooMany);
  // Another address is not held back.
  expect((await request.get(`/m/${member.pageKey}/pass?platform=apple`, { headers: asCaller() })).status()).toBe(200);
});

test('the Members screen tells a lead where wallet passes stand', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  await page.goto('/dashboard/members');
  const note = page.getByTestId('wallet-note');
  await expect(note).toBeVisible();
  // The test server runs the stand-in, and the note must say so.
  await expect(note).toContainText(w.noteStandIn);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
