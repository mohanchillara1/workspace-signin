// The leads' season chart of attendance. The people here are made up.
import { expect, test } from '@playwright/test';
import { importSheet, parseSheet } from '@/lib/attendance-sheet';
import { copy } from '@/lib/copy';
import { closeDb, db, logIn, watchConsole } from './helpers';

test.afterAll(closeDb);

// Its own address, so the page loads of the files before this one do not count against it.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.17' } });

const FILE = ['name,2026-07-06,2026-07-08', 'Chart Person A,TRUE,FALSE', 'Chart Person B,TRUE,TRUE'].join('\n');
const JULY = '/dashboard/attendance/chart?from=2026-07-01&to=2026-07-31';

test('a lead sees the season as a chart and changes a square with one tap', async ({ page }) => {
  const errors = watchConsole(page);
  await importSheet(db(), parseSheet(FILE), new Date());
  await logIn(page);

  // The one-day screen links to the chart.
  await page.goto('/dashboard/attendance');
  await page.getByRole('link', { name: copy.attendance.chartLink }).click();
  await page.waitForURL('**/dashboard/attendance/chart');
  await expect(page.getByRole('heading', { name: copy.attendance.chartTitle })).toBeVisible();

  await page.goto(JULY);
  const rowA = page.locator('tr[data-member-name="Chart Person A"]');
  const cell = (day: string) => rowA.locator(`td[data-day="${day}"]`);
  await expect(cell('2026-07-06')).toHaveAttribute('data-here', '1');
  await expect(cell('2026-07-08')).toHaveAttribute('data-here', '0');
  await expect(rowA.getByTestId('total')).toHaveText(copy.attendance.chartTotalOf(1, 2));
  await expect(page.getByTestId('day-total-2026-07-08')).toHaveText('1');

  // One tap marks them here.
  await cell('2026-07-08').getByRole('button').click();
  await expect(cell('2026-07-08')).toHaveAttribute('data-here', '1');
  await expect(rowA.getByTestId('total')).toHaveText(copy.attendance.chartTotalOf(2, 2));
  await expect(page.getByTestId('day-total-2026-07-08')).toHaveText('2');

  // It is saved, not only drawn.
  await page.reload();
  await expect(cell('2026-07-08')).toHaveAttribute('data-here', '1');

  // A second tap unmarks them, and the one-day screen says who changed it.
  await cell('2026-07-08').getByRole('button').click();
  await expect(cell('2026-07-08')).toHaveAttribute('data-here', '0');
  await page.goto('/dashboard/attendance?day=2026-07-08');
  await expect(page.getByTestId('changes')).toContainText('Chart Person A');

  expect(errors).toEqual([]);
});

test('the chart is for leads only', async ({ page }) => {
  const response = await page.goto(JULY);
  expect(new URL(page.url()).pathname).toBe('/admin');
  expect(response?.ok()).toBe(true);
});
