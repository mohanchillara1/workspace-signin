import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { copy } from '@/lib/copy';
import { addMember, setActive } from '@/lib/members';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, tapDone, watchConsole } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.afterAll(closeDb);

test('the member page shows their QR, tasks and count on a phone', async ({ page }) => {
  const errors = watchConsole(page);
  const actor = await captainId();
  const member = await addMember(db(), { firstName: 'Phone', lastName: 'Person' }, null);
  const task = await createTask(db(), { title: 'Phone job', audience: 'person', memberIds: [member.id], steps: ['Step one', 'Step two', 'Step three'] }, actor);
  await publishTask(db(), task.id, actor);

  await page.goto(`/m/${member.pageKey}`);
  await expect(page.getByRole('heading', { name: copy.member.greeting('Phone') })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId('count')).toBeVisible();

  // The QR holds the scan code, never the page key.
  const png = PNG.sync.read(await page.getByTestId('qr').screenshot());
  const read = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(read?.data).toBe(member.scanCode);
  expect(read?.data).not.toContain(member.pageKey);
  expect(await page.content()).not.toContain(`"${member.id}"`);

  // Ticked steps are still ticked after a reload.
  await page.getByLabel('Step two').check();
  await expect(page.getByText(copy.member.stepsDone(1, 3))).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Step two')).toBeChecked();
  await expect(page.getByLabel('Step one')).not.toBeChecked();

  // Done takes the task off the list.
  await tapDone(page);
  await expect(page.getByText('Phone job')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a wrong key and a deactivated member get the same not-found page', async ({ page }) => {
  const member = await addMember(db(), { firstName: 'Former', lastName: 'Person' }, null);
  await setActive(db(), member.id, false, null);
  for (const key of [member.pageKey, 'A'.repeat(32), 'short']) {
    const response = await page.goto(`/m/${key}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: copy.app.notFoundTitle })).toBeVisible();
    await expect(page.getByText('Former')).toHaveCount(0);
  }
});
