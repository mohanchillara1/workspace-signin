// Members type their first and last name on the login page and land on their own page.
import { expect, test, type Page } from '@playwright/test';
import { copy } from '@/lib/copy';
import { addMember } from '@/lib/members';
import { closeDb, db, logIn, watchConsole } from './helpers';

test.afterAll(closeDb);

async function byName(page: Page, first: string, last: string) {
  await page.goto('/login');
  const form = page.getByTestId('member-login');
  await form.getByLabel(copy.login.firstName).fill(first);
  await form.getByLabel(copy.login.lastName).fill(last);
  // One browser stands in for many people here, so nobody is kept signed in.
  await form.getByLabel(copy.login.remember).setChecked(false);
  await form.getByRole('button', { name: copy.login.memberSubmit }).click();
}

test.describe('member login by name', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a member lands on their own page with their QR code, and cannot open the dashboard', async ({ page }) => {
    const errors = watchConsole(page);
    const member = await addMember(db(), { firstName: 'Login', lastName: 'Alpha' }, null);
    await byName(page, 'login', 'ALPHA ');
    await page.waitForURL(`**/m/${member.pageKey}`);
    await expect(page.getByTestId('qr')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.member.greeting('Login'));
    await page.goto('/dashboard');
    await page.waitForURL('**/admin');
    expect(errors).toEqual([]);
  });

  test('a name not on the list says so and stays on the login page', async ({ page }) => {
    await byName(page, 'Login', 'Nobody');
    await expect(page.getByText(copy.login.memberNotFound)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a whole team logging in from one address does not lock out a lead on it', async ({ page }) => {
    const people = await Promise.all(Array.from({ length: 25 }, (_, i) => addMember(db(), { firstName: 'Wifi', lastName: `Person ${i}` }, null)));
    for (const [i, person] of people.entries()) {
      await byName(page, 'Wifi', `Person ${i}`);
      await page.waitForURL(`**/m/${person.pageKey}`);
    }
    await logIn(page);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
