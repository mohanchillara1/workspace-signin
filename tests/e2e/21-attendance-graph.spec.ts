// The leads' attendance graph. The people here are made up.
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { recordScan } from '@/lib/attendance';
import { importSheet, parseSheet } from '@/lib/attendance-sheet';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { members } from '@/lib/db/schema';
import { addSubteam, updateMember } from '@/lib/members';
import { closeDb, db, logIn, watchConsole } from './helpers';

test.afterAll(closeDb);

// Its own address, so the page loads of the files before this one do not count against it.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.21' } });

// February: no other browser test uses it, so these are the only meetings in the range.
const FILE = ['name,2026-02-02,2026-02-04,2026-02-06', 'Graph Person A,TRUE,TRUE,TRUE', 'Graph Person B,TRUE,FALSE,FALSE'].join('\n');
const FEBRUARY = '/dashboard/attendance/graph?from=2026-02-01&to=2026-02-28';
const SUBTEAM = 'Graph Test Team';
const a = copy.attendance;
let subteamId = '';
let personA = '';

test.beforeAll(async () => {
  await importSheet(db(), parseSheet(FILE), new Date());
  const team = await addSubteam(db(), SUBTEAM);
  subteamId = team.id;
  const people = await db().select().from(members).where(eq(members.firstName, 'Graph'));
  for (const person of people) await updateMember(db(), person.id, { subteamIds: [team.id] }, null);
  personA = people.find((p) => p.lastName === 'Person A')!.id;
});

const bar = (page: import('@playwright/test').Page, day: string) => page.locator(`[data-graph-day="${day}"]`);

test('a lead sees a bar for each meeting, taps one, and reads who comes least', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);

  // The one-day screen links to the graph.
  await page.goto('/dashboard/attendance');
  await page.getByRole('link', { name: a.graphLink, exact: true }).click();
  await page.waitForURL('**/dashboard/attendance/graph');
  await expect(page.getByRole('heading', { name: a.graphTitle })).toBeVisible();

  await page.goto(FEBRUARY);
  await expect(bar(page, '2026-02-02')).toHaveAttribute('data-here', '2');
  await expect(bar(page, '2026-02-04')).toHaveAttribute('data-here', '1');
  await expect(bar(page, '2026-02-06')).toHaveAttribute('data-here', '1');

  // The latest meeting is picked to start with. A tap picks another and lists who came and who missed.
  const panel = page.getByTestId('graph-day');
  await expect(bar(page, '2026-02-06')).toHaveAttribute('aria-pressed', 'true');
  await bar(page, '2026-02-04').click();
  await expect(bar(page, '2026-02-04')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('came')).toContainText('Graph Person A');
  await expect(panel.getByTestId('missed')).toContainText('Graph Person B');
  await expect(panel.getByTestId('came')).not.toContainText('Graph Person B');

  // Narrowed to the subteam, both halves hold only its two people, the lowest share first.
  await page.getByLabel(a.graphSubteam, { exact: true }).selectOption({ label: SUBTEAM });
  await page.getByRole('button', { name: a.show, exact: true }).click();
  await page.waitForURL(`**subteam=${subteamId}**`);
  await expect(bar(page, '2026-02-02')).toHaveAttribute('data-of', '2');
  const names = page.locator('[data-person-name]');
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveAttribute('data-person-name', 'Graph Person B');
  await expect(names.nth(0)).toContainText(a.graphShareOf(1, 3));
  await expect(names.nth(1)).toHaveAttribute('data-person-name', 'Graph Person A');

  // The numbers are there without the bars, too.
  await page.getByText(a.graphNumbers).click();
  await expect(page.getByTestId('graph-numbers')).toContainText('Mon, Feb 2');

  expect(errors).toEqual([]);
});

test('today\'s bar grows by itself when someone signs in', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  const today = chicagoDay(new Date());
  // Narrowed to the subteam, so nobody else's scans today change the count.
  await page.goto(`/dashboard/attendance/graph?subteam=${subteamId}`);
  await expect(page.getByRole('heading', { name: a.graphTitle })).toBeVisible();
  // Nobody from the subteam has come yet. With no scan from anyone today there is no bar for today at all.
  const before = (await bar(page, today).count()) ? await bar(page, today).getAttribute('data-here') : '0';
  expect(before).toBe('0');

  // A scan at the kiosk, while the page sits open. The test server updates every 2 seconds.
  await recordScan(db(), { memberId: personA, at: new Date(), kioskId: null });
  await expect(bar(page, today)).toHaveAttribute('data-here', '1', { timeout: 15_000 });

  expect(errors).toEqual([]);
});

test('the graph is for leads only', async ({ page }) => {
  const response = await page.goto(FEBRUARY);
  expect(new URL(page.url()).pathname).toBe('/admin');
  expect(response?.ok()).toBe(true);
});
