// The leads' review queue, in the browser.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { assignments, submissions } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { reviewQueue } from '@/lib/review';
import { createTask, finishHandout, openFor, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, logIn, watchConsole } from './helpers';

const r = copy.review;
test.use({ viewport: { width: 1440, height: 900 } });
test.afterAll(closeDb);

// Set SHOTS_DIR to also save a picture of each screen.
const shot = async (page: Page, name: string) => {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** A task finished with a check and a note saved with it, so it is waiting for a lead. */
async function waiting(title: string, extra: { who?: string; note?: string; link?: string; via?: 'kiosk' | 'member_page' } = {}) {
  const today = chicagoDay(new Date());
  const member = await addMember(db(), { firstName: 'Test', lastName: extra.who ?? `Member ${title}` }, null);
  const task = await createTask(db(), { title, audience: 'person', memberIds: [member.id] }, await captainId());
  await publishTask(db(), task.id, await captainId());
  const line = (await openFor(db(), member.id, today)).find((h) => h.title === title)!;
  const via = extra.via ?? 'member_page';
  const done = await db().transaction(async (tx) => {
    const result = await finishHandout(tx, { taskId: task.id, assignmentId: line.assignmentId, memberId: member.id, via, today, check: true });
    expect(result).toMatchObject({ ok: true, state: 'submitted' });
    const [row] = await tx
      .insert(submissions)
      .values({ assignmentId: result.assignmentId!, memberId: member.id, note: extra.note ?? '', link: extra.link ?? '', via })
      .returning();
    return { assignmentId: result.assignmentId!, submissionId: row.id };
  });
  return { member, task, ...done };
}

const stateOf = async (id: string) => (await db().select().from(assignments).where(eq(assignments.id, id)))[0].state;
const submissionOf = async (id: string) => (await db().select().from(submissions).where(eq(submissions.id, id)))[0];
// Each button says which task it is for ("Approve: <title>"), so a screen reader can tell them apart.
const press = (card: Locator, what: string, title: string) => card.getByRole('button', { name: `${what}: ${title}`, exact: true }).click();
const cardFor = (page: Page, title: string) => page.getByTestId('review-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('with nothing waiting the screen says so and what it means; otherwise it lists what waits', async ({ page }) => {
  const errors = watchConsole(page);
  await logIn(page);
  await page.goto('/dashboard/review');
  await expect(page.getByRole('heading', { name: r.title, exact: true })).toBeVisible();
  const queued = (await reviewQueue(db())).length;
  if (queued === 0) {
    await expect(page.getByTestId('review-empty')).toContainText(r.emptyTitle);
    await expect(page.getByTestId('review-empty')).toContainText(r.emptyBody);
    await expect(page.getByTestId('review-card')).toHaveCount(0);
    await shot(page, 'review-empty-1440');
  } else {
    await expect(page.getByTestId('review-card')).toHaveCount(queued);
    await expect(page.getByTestId('review-empty')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('a lead approves waiting work: it leaves the queue and shows on Finished as approved', async ({ page }) => {
  const errors = watchConsole(page);
  const w = await waiting('Review approve me', { who: 'Approve Person', note: 'Wired the left motor.', via: 'kiosk' });
  await logIn(page);
  await page.goto('/dashboard/review');
  const card = cardFor(page, 'Review approve me');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Test Approve Person');
  await expect(card).toContainText('Wired the left motor.');
  await expect(card).toContainText(r.viaKiosk);
  await shot(page, 'review-card-1440');
  await press(card, r.approve, 'Review approve me');
  await expect(cardFor(page, 'Review approve me')).toHaveCount(0);

  expect(await stateOf(w.assignmentId)).toBe('approved');
  const sub = await submissionOf(w.submissionId);
  expect(sub).toMatchObject({ decision: 'approved', reviewedById: await captainId() });
  expect(sub.reviewedAt).not.toBeNull();

  await page.goto('/dashboard/finished');
  const row = page.getByTestId('finished-row').filter({ hasText: 'Review approve me' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('approved-chip')).toHaveText(r.approvedChip);
  await expect(row.getByTestId('approved-line')).toContainText('Approved by Test Captain');
  // The "needs a check" chip does not sit on work a lead has approved.
  await expect(row).not.toContainText(copy.finished.needsCheck);
  await expect(row.getByRole('button', { name: copy.finished.reopen })).toBeVisible();
  await shot(page, 'finished-approved-1440');

  // Reopen still works: the task goes back to the member's list and loses its approved mark.
  await row.getByRole('button', { name: copy.finished.reopen }).click();
  await expect(page.getByTestId('finished-row').filter({ hasText: 'Review approve me' })).toHaveCount(0);
  expect(await stateOf(w.assignmentId)).toBe('open');
  expect(errors).toEqual([]);
});

test('a send-back with no comment is refused on the screen; with a comment it goes back on the member list', async ({ page }) => {
  const errors = watchConsole(page);
  const w = await waiting('Review send back me', { who: 'Send Back Person', note: 'All done.' });
  await logIn(page);
  await page.goto('/dashboard/review');
  const card = cardFor(page, 'Review send back me');

  await press(card, r.sendBack, 'Review send back me');
  await expect(card.getByTestId('review-problem')).toHaveText(r.commentNeeded);
  await shot(page, 'review-refused-1440');
  // Spaces alone are no comment either.
  await card.getByLabel(r.commentLabel).fill('   ');
  await press(card, r.sendBack, 'Review send back me');
  await expect(card.getByTestId('review-problem')).toHaveText(r.commentNeeded);
  await expect(card).toBeVisible();
  expect(await stateOf(w.assignmentId)).toBe('submitted');
  expect((await submissionOf(w.submissionId)).decision).toBeNull();

  await card.getByLabel(r.commentLabel).fill('Add the wire labels, then send it again.');
  await press(card, r.sendBack, 'Review send back me');
  await expect(cardFor(page, 'Review send back me')).toHaveCount(0);

  expect(await stateOf(w.assignmentId)).toBe('sent_back');
  expect(await submissionOf(w.submissionId)).toMatchObject({ decision: 'sent_back', comment: 'Add the wire labels, then send it again.' });
  const line = (await openFor(db(), w.member.id, chicagoDay(new Date()))).find((h) => h.title === 'Review send back me');
  expect(line).toMatchObject({ state: 'sent_back', sentBackComment: 'Add the wire labels, then send it again.' });
  expect(errors).toEqual([]);
});

test('work answered by another lead a moment ago is refused in plain words and left alone', async ({ page }) => {
  const w = await waiting('Review answered elsewhere');
  await logIn(page);
  await page.goto('/dashboard/review');
  const card = cardFor(page, 'Review answered elsewhere');
  await expect(card).toBeVisible();
  // Another lead gets there first.
  await db().update(assignments).set({ state: 'approved' }).where(eq(assignments.id, w.assignmentId));
  await press(card, r.approve, 'Review answered elsewhere');
  await expect(card.getByTestId('review-problem')).toHaveText(r.gone);
  expect((await submissionOf(w.submissionId)).decision).toBeNull();
});

test('a note is plain text and only an https link can be tapped', async ({ page }) => {
  const errors = watchConsole(page);
  await waiting('Review html note', { note: '<b id="injected">bold</b> <img src=x onerror="window.__pwned=1"> line one\nline two', link: 'javascript:alert(1)' });
  await waiting('Review https link', { link: 'https://example.com/my-photo' });
  await waiting('Review http link', { link: 'http://example.com/plain' });
  await logIn(page);
  await page.goto('/dashboard/review');

  const html = cardFor(page, 'Review html note');
  await expect(html.getByTestId('review-note')).toContainText('<b id="injected">bold</b>');
  await expect(page.locator('#injected')).toHaveCount(0);
  await expect(html.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(html.getByTestId('review-link')).toContainText('javascript:alert(1)');
  await expect(html.getByTestId('review-link').locator('a')).toHaveCount(0);

  const plain = cardFor(page, 'Review http link');
  await expect(plain.getByTestId('review-link')).toContainText('http://example.com/plain');
  await expect(plain.getByTestId('review-link').locator('a')).toHaveCount(0);

  const good = cardFor(page, 'Review https link').getByTestId('review-link').locator('a');
  await expect(good).toHaveAttribute('href', 'https://example.com/my-photo');
  await expect(good).toHaveAttribute('target', '_blank');
  await expect(good).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(errors).toEqual([]);
});

test('the review screen needs a login', async ({ page }) => {
  await page.goto('/dashboard/review');
  await page.waitForURL('**/admin');
  await expect(page.getByTestId('review-card')).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`the screen has no sideways scroll at ${width} wide, and the Review link is in the menu`, async ({ page }) => {
    const errors = watchConsole(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    // A long unbroken note and link must not push the page wider.
    await waiting(`Review wide ${width}`, { note: 'x'.repeat(400), link: `https://example.com/${'a'.repeat(300)}` });
    await logIn(page);
    await page.goto('/dashboard/review');
    await expect(page.getByTestId('review-card').first()).toBeVisible();
    const wider = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wider).toBe(false);
    await shot(page, `review-${width}`);

    if (width === 390) await page.getByRole('button', { name: copy.nav.menu }).click();
    const nav = width === 390 ? page.locator('#dashboard-menu nav') : page.locator('header nav').first();
    const links = await nav.getByRole('link').allInnerTexts();
    expect(links.slice(0, 4)).toEqual([copy.nav.today, copy.nav.tasks, r.navLabel, copy.nav.finished]);
    await expect(nav.getByRole('link', { name: r.navLabel })).toHaveAttribute('aria-current', 'page');
    if (width === 390) await shot(page, 'review-menu-390');
    await nav.getByRole('link', { name: copy.nav.finished }).click();
    await page.waitForURL('**/dashboard/finished');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await shot(page, `finished-${width}`);
    expect(errors).toEqual([]);
  });
}
