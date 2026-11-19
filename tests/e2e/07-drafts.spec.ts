import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { tasks } from '@/lib/db/schema';
import { closeDb, db, logIn, watchConsole } from './helpers';

// The test server runs with STEP_DRAFTS_STAND_IN=1 (scripts/e2e-server.ts), so no
// service is called and no key exists. The stand-in's steps mention the title.
test.use({ viewport: { width: 1440, height: 900 } });
test.afterAll(closeDb);

const SHOTS = '/mnt/c/Users/mohan/Desktop/Claude Code Stuff/mohanvault/01 Projects/Singularity Workspace Sign-in 2026-11-18/workflow/shots-lane-c';
const d = copy.drafts;
const t = copy.tasks;

const steps = (page: Page) => page.getByLabel(t.fieldSteps, { exact: true });
const drawButton = (page: Page) => page.getByRole('button', { name: d.button, exact: true });

async function noSideways(page: Page) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(wide).toBe(false);
}

async function openNew(page: Page, title: string) {
  await page.goto('/dashboard/tasks/new');
  await page.getByLabel(t.fieldTitle).fill(title);
  await page.getByLabel(t.audiencePool).check();
}

test('Draft steps fills the Steps box, the lead edits a line, and only Publish saves it', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  await openNew(page, 'Drafted bench tidy');
  await expect(drawButton(page)).toBeVisible();
  await expect(page.getByText(d.notice)).toBeVisible();

  await drawButton(page).click();
  await expect(page.getByText(d.filled)).toBeVisible();
  const lines = (await steps(page).inputValue()).split('\n');
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.length).toBeLessThanOrEqual(8);
  expect(lines.some((l) => l.includes('Drafted bench tidy'))).toBe(true);

  // Nothing is saved yet.
  expect(await db().select().from(tasks).where(eq(tasks.title, 'Drafted bench tidy'))).toHaveLength(0);

  // The lead edits one line and publishes.
  const edited = [...lines];
  edited[1] = 'Sweep under the bench first';
  await steps(page).fill(edited.join('\n'));
  await page.getByRole('button', { name: t.publish }).click();
  await expect(page.getByText(t.published)).toBeVisible();
  const [row] = await db().select().from(tasks).where(eq(tasks.title, 'Drafted bench tidy'));
  expect(row.steps).toEqual(edited);
  expect(row.state).toBe('published');
  expect(errors).toEqual([]);
});

test('with text already in the box the form asks first, and Keep leaves it alone', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  await openNew(page, 'Ask before replacing');
  await steps(page).fill('My own first step\nMy own second step');

  await drawButton(page).click();
  await expect(page.getByText(d.replaceAsk)).toBeVisible();
  // Asking changed nothing.
  await expect(steps(page)).toHaveValue('My own first step\nMy own second step');

  await page.getByRole('button', { name: d.replaceNo }).click();
  await expect(page.getByText(d.replaceAsk)).toHaveCount(0);
  await expect(steps(page)).toHaveValue('My own first step\nMy own second step');

  await drawButton(page).click();
  await page.getByRole('button', { name: d.replaceYes }).click();
  await expect(page.getByText(d.filled)).toBeVisible();
  const value = await steps(page).inputValue();
  expect(value).not.toContain('My own first step');
  expect(value).toContain('Ask before replacing');
  expect(errors).toEqual([]);
});

test('while it works the button says so and cannot be pressed twice', async ({ page }) => {
  await logIn(page);
  await openNew(page, 'Slow draft');
  let posts = 0;
  // Hold the draft request back so the working state can be seen.
  await page.route('**/dashboard/tasks/new', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    await route.continue();
  });
  await drawButton(page).click();
  const working = page.getByRole('button', { name: d.working, exact: true });
  await expect(working).toBeVisible();
  await expect(working).toBeDisabled();
  await working.click({ force: true }).catch(() => {});
  await expect(page.getByText(d.filled)).toBeVisible();
  expect(posts).toBe(1);
  await expect(drawButton(page)).toBeEnabled();
});

test('typing in the box while a draft is coming keeps what was typed', async ({ page }) => {
  await logIn(page);
  await openNew(page, 'Typed meanwhile');
  await page.route('**/dashboard/tasks/new', async (route) => {
    if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await drawButton(page).click();
  await steps(page).fill('I typed this while waiting');
  await expect(page.getByText(d.changedWhileWaiting)).toBeVisible();
  await expect(steps(page)).toHaveValue('I typed this while waiting');
});

test('no title gives a plain message and an empty box stays empty', async ({ page }) => {
  await logIn(page);
  await page.goto('/dashboard/tasks/new');
  await drawButton(page).click();
  await expect(page.getByText(d.needTitle)).toBeVisible();
  await expect(steps(page)).toHaveValue('');
});

test('the edit page has the button too, and a subteam task drafts', async ({ page }) => {
  await logIn(page);
  await page.goto('/dashboard/tasks/new');
  await page.getByLabel(t.fieldTitle).fill('Edit page draft');
  await page.getByLabel(t.audienceSubteam).check();
  await page.getByLabel(t.fieldSubteam, { exact: true }).selectOption({ label: 'Build' });
  await page.getByRole('button', { name: t.saveDraft }).click();
  await expect(page.getByText(t.saved)).toBeVisible();
  await expect(drawButton(page)).toBeVisible();
  await drawButton(page).click();
  await expect(page.getByText(d.filled)).toBeVisible();
  expect(await steps(page).inputValue()).toContain('Edit page draft');
});

for (const width of [390, 1440]) {
  test(`no sideways scroll at ${width} wide, with the button, the question and a draft`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await logIn(page);
    await openNew(page, 'Layout check for a task with a fairly long title so it wraps');
    await noSideways(page);
    await page.screenshot({ path: `${SHOTS}/new-task-button-${width}.png`, fullPage: true });
    await drawButton(page).click();
    await expect(page.getByText(d.filled)).toBeVisible();
    await noSideways(page);
    await page.screenshot({ path: `${SHOTS}/new-task-drafted-${width}.png`, fullPage: true });
    await drawButton(page).click();
    await expect(page.getByText(d.replaceAsk)).toBeVisible();
    await noSideways(page);
    await page.screenshot({ path: `${SHOTS}/new-task-asking-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('after ten drafts in a minute the next one is refused in plain words (runs last)', async ({ page }) => {
  await logIn(page);
  await openNew(page, 'Rate limit');
  let refused = false;
  for (let i = 0; i < 14 && !refused; i++) {
    await steps(page).fill('');
    await drawButton(page).click();
    await expect(page.getByText(d.filled).or(page.getByText(d.tooMany))).toBeVisible();
    refused = await page.getByText(d.tooMany).isVisible();
  }
  expect(refused).toBe(true);
  await expect(steps(page)).toHaveValue('');
});
