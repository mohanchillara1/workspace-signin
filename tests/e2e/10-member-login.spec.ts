// Members log in on the same form as leads and land on their own page.
import { expect, test, type Page } from '@playwright/test';
import { setMemberLogin } from '@/lib/auth/member-logins';
import { copy } from '@/lib/copy';
import type { Member } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { captainId, closeDb, db, logIn, state, watchConsole } from './helpers';

test.afterAll(closeDb);

const PASS = 'member login pass';

async function memberWithLogin(last: string, loginName: string): Promise<Member> {
  const member = await addMember(db(), { firstName: 'Login', lastName: last }, null);
  await setMemberLogin(db(), { memberId: member.id, loginName, password: PASS, actorId: await captainId(), now: new Date() });
  return member;
}

async function fillLogin(page: Page, loginName: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(copy.login.name).fill(loginName);
  await page.getByLabel(copy.login.password).fill(password);
  await page.getByRole('button', { name: copy.login.submit }).click();
}

test.describe('member login', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a member lands on their own page with their QR code, and cannot open the dashboard', async ({ page }) => {
    const errors = watchConsole(page);
    const member = await memberWithLogin('Alpha', 'loginalpha');
    await fillLogin(page, 'LoginAlpha', PASS);
    await page.waitForURL(`**/m/${member.pageKey}`);
    await expect(page.getByTestId('qr')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.member.greeting('Login'));

    await page.goto('/dashboard');
    await page.waitForURL('**/login');
    expect(errors).toEqual([]);
  });

  test('a wrong password says so and stays on the login page', async ({ page }) => {
    await memberWithLogin('Bravo', 'loginbravo');
    await fillLogin(page, 'loginbravo', 'not the password');
    await expect(page.getByText(copy.login.wrong)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logging in correctly many times never locks a member out', async ({ page }) => {
    // Before the fix, every correct member login was counted as a wrong try:
    // the sixth in 15 minutes was refused as "too many wrong tries".
    const member = await memberWithLogin('Charlie', 'logincharlie');
    for (let i = 0; i < 7; i++) {
      await fillLogin(page, 'logincharlie', PASS);
      await page.waitForURL(`**/m/${member.pageKey}`);
    }
  });

  test('many members logging in from one address do not lock out a lead on it', async ({ page }) => {
    // Every browser test comes from the same address, like a team on one wifi.
    // Before the fix, twenty correct member logins locked the address for everyone.
    const people = await Promise.all(Array.from({ length: 21 }, (_, i) => memberWithLogin(`Wifi ${i}`, `loginwifi${i}`)));
    for (const [i, person] of people.entries()) {
      await fillLogin(page, `loginwifi${i}`, PASS);
      await page.waitForURL(`**/m/${person.pageKey}`);
    }
    expect(state().captain.loginName).toBeTruthy();
    await logIn(page);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
