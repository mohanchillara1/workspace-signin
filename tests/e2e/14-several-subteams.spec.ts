// One person in several subteams, and a subteam that is part of another. The people here are made up.
import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { members } from '@/lib/db/schema';
import { closeDb, db, logIn, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '10.20.40.2' } });
test.afterAll(closeDb);

test('a lead puts one person in several subteams, and a task for the subteam above reaches them once', async ({ page }) => {
  const errors = watchConsole(page);
  const c = copy.members;
  await logIn(page);

  // A subteam on its own, then two that are part of it.
  await page.goto('/dashboard/members');
  for (const [name, partOf] of [['Drive Team', ''], ['Pit Crew', 'Drive Team'], ['Scouts', 'Drive Team']]) {
    await page.getByLabel(c.subteamName).fill(name);
    if (partOf) await page.getByLabel(c.subteamParent).selectOption({ label: partOf });
    await page.getByRole('button', { name: c.subteamAdd }).click();
    await expect(page.locator(`[data-subteam="${name}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-subteam="Pit Crew"] [data-part-of="Drive Team"]')).toHaveText(c.subteamPartOf('Drive Team'));
  // A subteam that is part of another is not offered as one to be part of.
  await expect(page.getByLabel(c.subteamParent).locator('option', { hasText: 'Pit Crew' })).toHaveCount(0);
  // Drive Team has subteams under it, so it cannot be removed. Scouts, with nobody in it, can.
  await expect(page.locator('[data-subteam="Drive Team"]').getByRole('button')).toHaveCount(0);
  await expect(page.locator('[data-subteam="Scouts"]').getByRole('button')).toHaveCount(1);

  // One person, three subteams.
  await page.getByLabel(c.firstName, { exact: true }).fill('Multi');
  await page.getByLabel(c.lastName, { exact: true }).fill('Person');
  const ticks = page.getByRole('group', { name: c.subteams }).first();
  for (const name of ['Pit Crew', 'Scouts', 'Programming']) await ticks.getByLabel(name, { exact: true }).check();
  await page.getByRole('button', { name: c.add }).click();
  // Under each subteam they are in, and under the one those are part of.
  for (const group of ['Pit Crew', 'Scouts', 'Programming', 'Drive Team']) {
    await expect(page.locator(`[data-group="${group}"] [data-member-name="Multi Person"]`)).toHaveCount(1);
  }
  await expect(page.locator(`[data-group="${c.groupNone}"] [data-member-name="Multi Person"]`)).toHaveCount(0);
  await expect(page.locator('[data-group="Build"] [data-member-name="Multi Person"]')).toHaveCount(0);
  await expect(page.locator('[data-subteam="Drive Team"]')).toContainText(c.subteamUse(1, 0));

  // A task for the subteam above: the form says who else it goes to.
  await page.goto('/dashboard/tasks/new');
  await page.getByLabel(copy.tasks.fieldTitle).fill('Drive team job');
  await page.getByLabel(copy.tasks.audienceSubteam).check();
  await page.getByLabel(copy.tasks.fieldSubteam, { exact: true }).selectOption({ label: `Pit Crew (${c.subteamPartOf('Drive Team')})` });
  await expect(page.getByTestId('subteam-also')).toHaveCount(0);
  await page.getByLabel(copy.tasks.fieldSubteam, { exact: true }).selectOption({ label: 'Drive Team' });
  await expect(page.getByTestId('subteam-also')).toHaveText(copy.tasks.subteamAlso('Pit Crew, Scouts'));
  await page.getByRole('button', { name: copy.tasks.publish }).click();
  await expect(page.getByText(copy.tasks.published)).toBeVisible();

  // On their own page: once, though two of their subteams are part of Drive Team.
  const [multi] = await db().select().from(members).where(and(eq(members.firstName, 'Multi'), eq(members.lastName, 'Person')));
  await page.goto(`/m/${multi.pageKey}`);
  await expect(page.locator('section[data-group="subteam"] [data-testid="task"]', { hasText: 'Drive team job' })).toHaveCount(1);

  // Their page on the dashboard shows all three, and Today lists them on one line.
  await page.goto(`/dashboard/members/${multi.id}`);
  await expect(page.locator('[data-subteam-chip]')).toHaveText(['Pit Crew', 'Programming', 'Scouts']);
  await expect(page.getByTestId('member-tasks')).toContainText('Drive team job');
  await page.goto('/dashboard');
  await expect(page.getByText('Pit Crew, Programming, Scouts')).toBeVisible();

  // Take them out of both Drive Team subteams: the task leaves, Programming stays.
  await page.goto(`/dashboard/members/${multi.id}`);
  const edit = page.getByRole('group', { name: c.subteams });
  await expect(edit.getByLabel('Scouts', { exact: true })).toBeChecked();
  await edit.getByLabel('Pit Crew', { exact: true }).uncheck();
  await edit.getByLabel('Scouts', { exact: true }).uncheck();
  await page.getByRole('button', { name: c.save, exact: true }).click();
  await expect(page.locator('[data-subteam-chip]')).toHaveText(['Programming']);
  await expect(page.getByText(c.detailNoTasks)).toBeVisible();
  await page.goto('/dashboard/members');
  await expect(page.locator('[data-group="Programming"] [data-member-name="Multi Person"]')).toHaveCount(1);
  await expect(page.locator('[data-group="Drive Team"]')).toHaveCount(0);
  await page.goto(`/m/${multi.pageKey}`);
  await expect(page.locator('[data-testid="task"]', { hasText: 'Drive team job' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
