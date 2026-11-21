// Deleting a task from its page, and "Keep me signed in" for members and leads.
import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { tasks } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, logIn, state, watchConsole } from './helpers';

test.afterAll(closeDb);

// Its own address, so the page loads of the files before this one do not count against it.
// Without it a member page here can answer "Slow down" when earlier files used up the minute.
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.21' } });

test('a lead deletes a task in two taps, and it is gone from the list and the member page', async ({ page }) => {
  const errors = watchConsole(page);
  const member = await addMember(db(), { firstName: 'Gone', lastName: 'Task' }, null);
  const task = await createTask(db(), { title: 'Delete this one', audience: 'person', memberIds: [member.id] }, await captainId());
  await publishTask(db(), task.id, await captainId());
  await logIn(page);
  await page.goto(`/dashboard/tasks/${task.id}`);
  const panel = page.getByTestId('delete-task');
  await panel.getByRole('button', { name: copy.tasks.deleteButton }).click();
  // The first tap only asks; "Keep it" backs out.
  await panel.getByRole('button', { name: copy.tasks.deleteCancel }).click();
  expect(await db().select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(1);
  await panel.getByRole('button', { name: copy.tasks.deleteButton }).click();
  await panel.getByRole('button', { name: copy.tasks.deleteConfirm }).click();
  await page.waitForURL('**/dashboard/tasks?note=deleted');
  await expect(page.getByTestId('task-deleted')).toHaveText(copy.tasks.deleted);
  await expect(page.getByText('Delete this one')).toHaveCount(0);
  expect(await db().select().from(tasks).where(eq(tasks.id, task.id))).toHaveLength(0);
  await page.goto(`/m/${member.pageKey}`);
  await expect(page.getByText('Delete this one')).toHaveCount(0);
  expect(errors).toEqual([]);
});

async function byName(page: Page, first: string, last: string, remember: boolean) {
  await page.goto('/login');
  const form = page.getByTestId('member-login');
  await form.getByLabel(copy.login.firstName).fill(first);
  await form.getByLabel(copy.login.lastName).fill(last);
  await form.getByLabel(copy.login.remember).setChecked(remember);
  await form.getByRole('button', { name: copy.login.memberSubmit }).click();
}

test('a member who keeps signed in goes straight to their page, until they sign out', async ({ page }) => {
  const member = await addMember(db(), { firstName: 'Keep', lastName: 'Me' }, null);
  await byName(page, 'Keep', 'Me', true);
  await page.waitForURL(`**/m/${member.pageKey}`);
  await page.goto('/login');
  await page.waitForURL(`**/m/${member.pageKey}`);

  await page.getByTestId('member-sign-out').click();
  await page.waitForURL('**/login');
  await expect(page.getByTestId('member-login')).toBeVisible();
});

test('a member who leaves it off types their name again next time', async ({ page }) => {
  const member = await addMember(db(), { firstName: 'Dont', lastName: 'Keep' }, null);
  await byName(page, 'Dont', 'Keep', false);
  await page.waitForURL(`**/m/${member.pageKey}`);
  await expect(page.getByTestId('member-sign-out')).toHaveCount(0);
  await page.goto('/login');
  await expect(page.getByTestId('member-login')).toBeVisible();
});

test('a lead who keeps signed in gets a lasting cookie; one who does not gets one that ends with the browser', async ({ browser }) => {
  const { captain } = state();
  for (const remember of [true, false]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/admin');
    await page.getByLabel(copy.login.name).fill(captain.loginName);
    await page.getByLabel(copy.login.password).fill(captain.password);
    await page.getByLabel(copy.login.remember).setChecked(remember);
    await page.getByRole('button', { name: copy.login.submit }).click();
    await page.waitForURL('**/dashboard');
    const cookie = (await context.cookies()).find((c) => c.name === 'lead')!;
    if (remember) expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 60 * 86_400);
    else expect(cookie.expires).toBe(-1);
    await context.close();
  }
});
