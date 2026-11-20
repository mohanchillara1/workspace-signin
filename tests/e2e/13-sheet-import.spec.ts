// A season brought in from the team's old attendance sheet. The people here are made up.
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { importSheet, parseSheet } from '@/lib/attendance-sheet';
import { copy } from '@/lib/copy';
import { chicagoDay, dayLabel } from '@/lib/day';
import { members } from '@/lib/db/schema';
import { closeDb, db, logIn, watchConsole } from './helpers';

test.afterAll(closeDb);

// Its own address, so the page loads of the files before this one do not count against it.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.1' } });

const FILE = ['name,2026-08-03,2026-08-05,2026-08-10', 'Sheet Person A,TRUE,FALSE,TRUE', 'Sheet Person B,FALSE,FALSE,FALSE'].join('\n');

test("rows from the sheet count on a person's own page and show a lead where they came from", async ({ page }) => {
  const errors = watchConsole(page);
  const now = new Date();
  await importSheet(db(), parseSheet(FILE), now);
  const [a] = await db().select().from(members).where(eq(members.lastName, 'Person A'));

  // Their row was made today, and their count still takes in the sheet's days.
  await page.goto(`/m/${a.pageKey}`);
  await expect(page.getByTestId('count')).toHaveText(copy.member.count(2, 3, dayLabel('2026-08-03')));

  await logIn(page);
  await page.goto('/dashboard/attendance?day=2026-08-03');
  const row = page.locator('[data-member-name="Sheet Person A"]');
  await expect(row).toContainText(copy.attendance.fromSheet(dayLabel(chicagoDay(now))));
  // Nobody scanned, so no time is shown as if someone had.
  await expect(row).not.toContainText(/scanned|AM|PM/);
  await expect(page.getByText(copy.attendance.meetingNote)).toBeVisible();
  await expect(page.locator('[data-member-name="Sheet Person B"]')).toContainText(copy.attendance.markHere);

  const csv = await (await page.request.get('/dashboard/attendance/export?from=2026-08-03&to=2026-08-10')).text();
  expect(csv).toContain(`2026-08-03,Sheet,Person A,,,${copy.attendance.csvSheet},\r\n`);
  expect(csv).toContain(`2026-08-10,Sheet,Person A,,,${copy.attendance.csvSheet},\r\n`);
  expect(csv).not.toContain('Person B');
  expect(errors).toEqual([]);
});
