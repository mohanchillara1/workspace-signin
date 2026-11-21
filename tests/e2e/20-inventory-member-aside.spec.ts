// A member takes an item off the list from their phone. It asks once, and it is set aside, never deleted.
// The people and the items here are made up.
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { inventoryItems } from '@/lib/db/schema';
import { addItem } from '@/lib/inventory';
import { addMember } from '@/lib/members';
import { captainId, closeDb, db, logIn, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.22' } });
test.afterAll(closeDb);

const c = copy.inventory;

test("a member taps \"We don't have this\", says yes once, and the item leaves the list; the log names them", async ({ page, browser }) => {
  const errors = watchConsole(page);
  const member = await addMember(db(), { firstName: 'Aside', lastName: 'Member' }, null);
  const item = await addItem(db(), { name: 'Aside bolts', category: 'Hardware', count: 5 }, await captainId());
  await addItem(db(), { name: 'Aside nuts', category: 'Hardware', count: 7 }, await captainId());
  await logIn(page);
  await page.goto('/dashboard/inventory');
  const lever = page.getByTestId('members-switch');
  if (await lever.getByRole('button', { name: c.turnOn }).count()) await lever.getByRole('button', { name: c.turnOn }).click();
  await expect(lever).toContainText(c.membersOn);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.23' } });
  const theirs = await phone.newPage();
  const theirErrors = watchConsole(theirs);
  await theirs.goto(`/m/${member.pageKey}/inventory?g=Hardware`);
  const card = theirs.locator('[data-item="Aside bolts"]');
  const have = async () => (await db().select().from(inventoryItems).where(eq(inventoryItems.id, item.id)))[0];

  // The first tap only asks.
  await card.getByText(c.memberAside).click();
  await expect(card.getByRole('button', { name: c.memberAsideConfirm })).toBeVisible();
  expect((await have()).have).toBe(true);
  await card.getByRole('button', { name: c.memberAsideConfirm }).click();

  // Gone from their list, still in the database with its count, and the same group comes back.
  await expect(theirs).toHaveURL(/[?&]g=Hardware/);
  await expect(theirs.getByRole('status')).toHaveText(c.memberAsideDone);
  await expect(theirs.locator('[data-item="Aside bolts"]')).toHaveCount(0);
  await expect(theirs.locator('[data-item="Aside nuts"]')).toHaveCount(1);
  expect(await have()).toMatchObject({ have: false, count: 5 });

  // Still not theirs: an exact count or a photo.
  await expect(theirs.getByRole('button', { name: c.set })).toHaveCount(0);
  await expect(theirs.getByTestId('photo-input')).toHaveCount(0);
  expect(theirErrors).toEqual([]);

  // A lead sees who did it, and finds it in the set-aside list to bring back.
  await page.goto('/dashboard/inventory/log');
  const row = page.getByTestId('inventory-log').locator('tbody tr').filter({ hasText: 'Aside bolts' }).first();
  await expect(row).toContainText('Aside Member');
  await expect(row).toContainText(c.logAside);

  await page.goto('/dashboard/inventory');
  await page.getByTestId('members-switch').getByRole('button', { name: c.turnOff }).click();
  await phone.close();
  expect(errors).toEqual([]);
});
