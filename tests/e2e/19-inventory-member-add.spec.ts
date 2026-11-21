// A member adds an item the list is missing, from inside a group. The people and the items here are made up.
import { expect, test } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addItem, setHave } from '@/lib/inventory';
import { addMember } from '@/lib/members';
import { captainId, closeDb, db, logIn, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.19' } });
test.afterAll(closeDb);

const c = copy.inventory;

test('a member adds a missing item to a group, cannot add one twice, and brings back one a lead set aside', async ({ page, browser }) => {
  const errors = watchConsole(page);
  const member = await addMember(db(), { firstName: 'Adding', lastName: 'Member' }, null);
  await addItem(db(), { name: 'Shelf nuts', category: 'Hardware', count: 10 }, await captainId());
  const aside = await addItem(db(), { name: 'Old gearbox', category: 'Drivetrain and mechanical' }, await captainId());
  await setHave(db(), aside.id, false, await captainId());
  await logIn(page);
  await page.goto('/dashboard/inventory');
  const lever = page.getByTestId('members-switch');
  if (await lever.getByRole('button', { name: c.turnOn }).count()) await lever.getByRole('button', { name: c.turnOn }).click();
  await expect(lever).toContainText(c.membersOn);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.20' } });
  const theirs = await phone.newPage();
  const theirErrors = watchConsole(theirs);
  await theirs.goto(`/m/${member.pageKey}/inventory?g=Hardware`);
  const form = theirs.getByTestId('member-add-item');

  // A new item goes into the group they are looking at, with their count.
  await form.getByLabel(c.name).fill('Shelf washers');
  await form.getByLabel(c.startCount).fill('25');
  await form.getByRole('button', { name: c.memberAddButton }).click();
  await expect(theirs).toHaveURL(/[?&]g=Hardware/);
  await expect(theirs.locator('[data-item="Shelf washers"]').getByTestId('item-count')).toHaveText('25');

  // One already on the shelves is refused, whatever its case.
  await form.getByLabel(c.name).fill('shelf NUTS');
  await form.getByRole('button', { name: c.memberAddButton }).click();
  await expect(theirs.getByText(c.problem(copy.errors.inventoryNameTaken))).toBeVisible();
  await expect(theirs.locator('[data-item="Shelf nuts"]')).toHaveCount(1);

  // One a lead set aside comes back, in its own group.
  await form.getByLabel(c.name).fill('old gearbox');
  await form.getByRole('button', { name: c.memberAddButton }).click();
  await expect(theirs).toHaveURL(/[?&]g=Drivetrain%20and%20mechanical/);
  await expect(theirs.locator('[data-item="Old gearbox"]').getByTestId('item-count')).toHaveText(c.notCounted);

  // Still not theirs: an exact count or a photo. Setting an item aside is in 20-inventory-member-aside.
  await expect(theirs.getByRole('button', { name: c.set })).toHaveCount(0);
  await expect(theirs.getByTestId('photo-input')).toHaveCount(0);
  expect(theirErrors).toEqual([]);

  // The leads' log names them.
  await page.goto('/dashboard/inventory/log');
  const log = page.getByTestId('inventory-log');
  await expect(log.locator('tbody tr').filter({ hasText: 'Shelf washers' })).toHaveText([
    /Adding Member.*Shelf washers.*Counted.*25/,
    /Adding Member.*Shelf washers.*/ ,
  ]);
  await expect(log.locator('tbody tr').filter({ hasText: 'Shelf washers' }).nth(1)).toContainText(c.logAdded);
  await expect(log.locator('tbody tr').filter({ hasText: 'Old gearbox' }).first()).toContainText(c.logBack);

  await page.goto('/dashboard/inventory');
  await page.getByTestId('members-switch').getByRole('button', { name: c.turnOff }).click();
  await phone.close();
  expect(errors).toEqual([]);
});
