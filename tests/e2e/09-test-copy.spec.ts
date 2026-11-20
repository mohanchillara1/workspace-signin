// The test server runs with TEST_COPY=1, the way a hosted copy with made-up
// names does. The tag has to be on the leads' screens and on the kiosk, and it
// must not push anything sideways. (That it is absent when the switch is off
// is checked by the screenshot script, whose server runs without it.)
import { expect, test, type Page } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addMember } from '@/lib/members';
import { closeDb, db, feed, logIn, pairByCookie, watchConsole } from './helpers';

const t = copy.testCopy;
test.afterAll(closeDb);

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

for (const [label, viewport] of [
  ['a wide screen', { width: 1440, height: 900 }],
  ['a phone', { width: 390, height: 844 }],
] as const) {
  test(`the dashboard header says this is a test copy, on ${label}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = watchConsole(page);
    await logIn(page);
    for (const path of ['/dashboard', '/dashboard/members']) {
      await page.goto(path);
      const tag = page.locator('header').getByTestId('test-copy');
      await expect(tag).toBeVisible();
      await expect(tag).toContainText(t.tag);
      await expect(tag).toContainText(t.dashboard);
      expect(await sideways(page)).toBe(false);
      // The tag is a thin row: it never takes more of the screen than the bar under it.
      const heights = await page.evaluate(() => ({
        tag: document.querySelector('header [data-testid="test-copy"]')!.getBoundingClientRect().height,
        bar: document.querySelector('[data-testid="nav-bar"]')!.getBoundingClientRect().height,
      }));
      expect(heights.tag).toBeLessThan(heights.bar);
    }
    expect(errors).toEqual([]);
  });
}

for (const [label, viewport] of [
  ['upright', { width: 1024, height: 1366 }],
  ['on its side', { width: 1366, height: 1024 }],
] as const) {
  test(`the kiosk footer says this is a test copy, ${label}, before and after a scan`, async ({ browser }) => {
    const member = await addMember(db(), { firstName: 'Tag', lastName: `Reader ${viewport.width}` }, null);
    const wall = await browser.newContext({ viewport });
    await pairByCookie(wall, `Tag kiosk ${viewport.width}`);
    const kiosk = await wall.newPage();
    await kiosk.goto('/kiosk');
    const tag = kiosk.locator('footer').getByTestId('test-copy');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText(t.tag);
    await expect(tag).toContainText(t.kiosk);
    expect(await sideways(kiosk)).toBe(false);

    await feed(kiosk, member.scanCode);
    await expect(kiosk.getByRole('heading', { name: copy.kiosk.hello('Tag') })).toBeVisible();
    await expect(tag).toBeVisible();
    // Still on the screen, and the way back is still there to tap.
    const box = await tag.boundingBox();
    expect(box && box.y + box.height <= viewport.height).toBe(true);
    await expect(kiosk.getByRole('button', { name: copy.kiosk.backNow })).toBeVisible();
    expect(await sideways(kiosk)).toBe(false);
    await wall.close();
  });
}
