// Leads and captains log in on their own page, /admin. The main login page is for members.
import { expect, test } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addMember } from '@/lib/members';
import { closeDb, db, state, watchConsole } from './helpers';

// Its own address: a wrong password here must not count against the other files.
test.use({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.3' } });
test.afterAll(closeDb);

const c = copy.login;

test('the main login page has only the members form, with one small link to the admin login', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/login');
  await expect(page.getByTestId('member-login')).toBeVisible();
  await expect(page.getByTestId('lead-login')).toHaveCount(0);
  await expect(page.getByLabel(c.password)).toHaveCount(0);
  await page.getByRole('link', { name: c.toAdmin }).click();
  await page.waitForURL('**/admin');
  await expect(page.getByTestId('lead-login')).toBeVisible();
  await expect(page.getByTestId('member-login')).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await page.getByRole('link', { name: c.toMembers }).click();
  await page.waitForURL('**/login');
  expect(errors).toEqual([]);
});

test('a captain logs in at /admin; a wrong password stays there; the members page still works while logged in', async ({ page }) => {
  const errors = watchConsole(page);
  const { captain } = state();
  await page.goto('/admin');
  await page.getByLabel(c.name).fill(captain.loginName);
  await page.getByLabel(c.password).fill('not the password');
  await page.getByRole('button', { name: c.submit }).click();
  await expect(page.getByText(c.wrong)).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
  // The form empties itself after a refused try, so both boxes are typed again.
  await page.getByLabel(c.name).fill(captain.loginName);
  await page.getByLabel(c.password).fill(captain.password);
  await page.getByRole('button', { name: c.submit }).click();
  await page.waitForURL('**/dashboard');
  // Already logged in: the admin login goes straight to the dashboard.
  await page.goto('/admin');
  await page.waitForURL('**/dashboard');
  // The members page is not theirs to be sent away from: a captain can open a member's page by name.
  const member = await addMember(db(), { firstName: 'Portal', lastName: 'Member' }, null);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
  const form = page.getByTestId('member-login');
  await form.getByLabel(c.firstName).fill('Portal');
  await form.getByLabel(c.lastName).fill('Member');
  await form.getByRole('button', { name: c.memberSubmit }).click();
  await page.waitForURL(`**/m/${member.pageKey}`);
  // Logging out lands on the admin login, and the dashboard asks for it again.
  await page.goto('/dashboard');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: copy.nav.logout }).click();
  await page.waitForURL('**/admin');
  await page.goto('/dashboard/members');
  await expect(page).toHaveURL(/\/admin$/);
  expect(errors).toEqual([]);
});

test('a device that is not the kiosk yet is pointed at the admin login', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page.getByRole('link', { name: copy.kiosk.notPairedLink })).toHaveAttribute('href', '/admin');
});
