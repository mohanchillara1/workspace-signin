// The search bar on the inventory finds an item in any group and opens it.
import { expect, test } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addItem } from '@/lib/inventory';
import { captainId, closeDb, db, logIn, watchConsole } from './helpers';

test.afterAll(closeDb);

test('a lead finds an item by part of its name and goes straight to it', async ({ page }) => {
  const errors = watchConsole(page);
  const item = await addItem(db(), { name: 'Searchable hex nut', category: 'Hardware', count: 42 }, await captainId());
  await addItem(db(), { name: 'Searchable drill', category: 'Tools' }, await captainId());
  await logIn(page);
  await page.goto('/dashboard/inventory');
  const search = page.getByLabel(copy.inventory.searchLabel);
  await search.fill('HEX  searchable');
  const results = page.getByTestId('search-results');
  await expect(results.locator('[data-result]')).toHaveCount(1);
  await expect(results).toContainText('42');
  await search.fill('zzzz no such thing');
  await expect(page.getByTestId('search-none')).toHaveText(copy.inventory.searchNone);
  await search.fill('searchable hex');
  await results.locator('[data-result="Searchable hex nut"]').click();
  await page.waitForURL(`**/dashboard/inventory?g=Hardware#i-${item.id}`);
  await expect(page.locator(`#i-${item.id}`)).toBeInViewport();
  expect(errors).toEqual([]);
});
