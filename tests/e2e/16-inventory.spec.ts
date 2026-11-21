// The inventory: leads keep the list, members add to and take from counts, and a log says who did what.
// The people and the items here are made up.
import { expect, test } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addItem } from '@/lib/inventory';
import { addMember } from '@/lib/members';
import { captainId, closeDb, db, logIn, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.4' } });
test.afterAll(closeDb);

const c = copy.inventory;
// A one-pixel PNG, standing in for a photo from a phone.
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('a lead keeps the list: add an item, count it, add to it, take from it, give it a photo, set it aside', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  await page.getByRole('link', { name: copy.nav.inventory }).click();
  await page.waitForURL('**/dashboard/inventory');

  await page.getByLabel(c.name).fill('Test gizmo');
  await page.getByLabel(c.group, { exact: true }).selectOption('Motors');
  await page.getByLabel(c.startCount).fill('3');
  await page.getByRole('button', { name: c.add }).click();
  const card = page.locator('[data-inventory-group="Motors"] [data-item="Test gizmo"]');
  const count = card.getByTestId('item-count');
  await expect(count).toHaveText('3');
  // No photo yet: the drawing for its group.
  await expect(card.locator('[data-drawing]')).toHaveCount(1);

  const act = async (amount: string, button: string) => {
    await card.getByLabel(c.amount).fill(amount);
    await card.getByRole('button', { name: button, exact: true }).click();
  };
  await act('10', c.set);
  await expect(count).toHaveText('10');
  await act('2', c.put);
  await expect(count).toHaveText('12');
  await act('5', c.take);
  await expect(count).toHaveText('7');
  await act('100', c.take);
  await expect(page.getByText(c.problem(copy.errors.inventoryTakeTooMany))).toBeVisible();
  await expect(count).toHaveText('7');

  // The same name a second time is refused in words.
  await page.getByLabel(c.name).fill('test GIZMO');
  await page.getByRole('button', { name: c.add }).click();
  await expect(page.getByText(c.problem(copy.errors.inventoryNameTaken))).toBeVisible();
  // The screen opens on one tile for each group, so a phone is not handed the whole list at once.
  await addItem(db(), { name: 'Tile test part', category: 'Tools' }, await captainId());
  await page.goto('/dashboard/inventory');
  const tiles = page.getByTestId('inventory-tiles');
  await expect(tiles.locator('[data-tile="Motors"]')).toBeVisible();
  await expect(page.locator('[data-item]')).toHaveCount(0);
  await tiles.locator('[data-tile="Tools"]').click();
  await expect(page).toHaveURL(/[?&]g=Tools$/);
  await expect(page.locator('[data-inventory-group="Tools"] [data-item="Tile test part"]')).toBeVisible();
  // Only that group's items are on the page.
  await expect(page.locator('[data-item="Test gizmo"]')).toHaveCount(0);
  await page.getByRole('link', { name: c.allGroups }).click();
  await page.getByTestId('inventory-tiles').locator('[data-tile="Motors"]').click();
  await expect(count).toHaveText('7');
  await expect(page.locator('[data-item="Test gizmo"]')).toHaveCount(1);

  // A photo: the browser shrinks it and the page shows it in place of the drawing.
  await card.getByTestId('photo-input').setInputFiles({ name: 'part.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL, 'base64') });
  const photo = card.locator('img[data-photo]');
  await expect(photo).toHaveCount(1);
  await expect(card.locator('[data-drawing]')).toHaveCount(0);
  const sent = await page.request.get((await photo.getAttribute('src'))!);
  expect(sent.status()).toBe(200);
  expect(sent.headers()['content-type']).toBe('image/jpeg');
  expect((await page.request.get('/inventory-photo/00000000-0000-4000-8000-000000000000')).status()).toBe(404);

  // "We don't have this" sets it aside, count and photo kept, and it can come back.
  await card.getByRole('button', { name: c.dontHave }).click();
  await expect(card).toHaveCount(0);
  const aside = page.getByTestId('inventory-aside');
  await aside.locator('summary').click();
  await aside.locator('[data-aside-item="Test gizmo"]').getByRole('button', { name: c.doHave }).click();
  await expect(count).toHaveText('7');
  await expect(card.locator('img[data-photo]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('members get the inventory only when a captain opens it; they add and take, change nothing else, and the log names them', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const member = await addMember(db(), { firstName: 'Shelf', lastName: 'Member' }, null);
  await addItem(db(), { name: 'Shelf bolts', category: 'Hardware', count: 20 }, await captainId());
  await logIn(page);
  await page.goto('/dashboard/inventory');
  const lever = page.getByTestId('members-switch');
  // Another file may have left it open.
  if (await lever.getByRole('button', { name: c.turnOff }).count()) await lever.getByRole('button', { name: c.turnOff }).click();
  await expect(lever).toContainText(c.membersOff);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.5' } });
  const theirs = await phone.newPage();
  const theirErrors = watchConsole(theirs);
  const address = `/m/${member.pageKey}/inventory`;
  await theirs.goto(`/m/${member.pageKey}`);
  await expect(theirs.getByTestId('inventory-link')).toHaveCount(0);
  expect((await theirs.request.get(address)).status()).toBe(404);

  await lever.getByRole('button', { name: c.turnOn }).click();
  await expect(lever).toContainText(c.membersOn);
  await theirs.goto(`/m/${member.pageKey}`);
  await theirs.getByTestId('inventory-link').click();
  await theirs.waitForURL(`**${address}`);
  const card = theirs.locator('[data-item="Shelf bolts"]');
  const count = card.getByTestId('item-count');
  // A member's page opens on tiles too. Tapping one shows that group, and a change brings the same group back.
  await expect(card).toHaveCount(0);
  await theirs.getByTestId('inventory-tiles').locator('[data-tile="Hardware"]').click();
  await expect(theirs).toHaveURL(/[?&]g=Hardware$/);
  await expect(count).toHaveText('20');
  const act = async (amount: string, button: string) => {
    await card.getByLabel(c.amount).fill(amount);
    await card.getByRole('button', { name: button, exact: true }).click();
  };
  await act('3', c.take);
  await expect(count).toHaveText('17');
  await act('2', c.put);
  await expect(count).toHaveText('19');
  await act('500', c.take);
  await expect(theirs.getByText(c.problem(copy.errors.inventoryTakeTooMany))).toBeVisible();
  await expect(count).toHaveText('19');
  // Not theirs to change: an exact count or a photo. Adding an item is in 19-inventory-member-add, setting one aside in 20-inventory-member-aside.
  await expect(theirs.getByRole('button', { name: c.set })).toHaveCount(0);
  await expect(theirs.getByTestId('photo-input')).toHaveCount(0);
  expect(theirErrors).toEqual([]);

  // The log, for leads: who, what, how many, newest first.
  await page.goto('/dashboard/inventory');
  await page.getByRole('link', { name: c.logLink }).click();
  const rows = page.getByTestId('inventory-log').locator('tbody tr').filter({ hasText: 'Shelf bolts' });
  await expect(rows).toHaveText([
    /Shelf Member.*Shelf bolts.*Added 2.*19/,
    /Shelf Member.*Shelf bolts.*Took 3.*17/,
    // The count it was added with comes right after the line for adding it.
    /Test Captain.*Shelf bolts.*Counted.*20/,
    new RegExp(`Test Captain.*Shelf bolts.*${c.logAdded}`),
  ]);

  // Closed again: the page is gone for them, and a change sent anyway does nothing.
  await page.goto('/dashboard/inventory');
  await page.getByTestId('members-switch').getByRole('button', { name: c.turnOff }).click();
  await expect(page.getByTestId('members-switch')).toContainText(c.membersOff);
  expect((await theirs.request.get(address)).status()).toBe(404);
  await phone.close();
  expect(errors).toEqual([]);
});
