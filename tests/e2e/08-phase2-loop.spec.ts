// The whole phase 2 loop across the three lanes, with nothing arranged by hand
// in between: a member sends work in, a lead sends it back, the member sends
// it again, the lead approves, and it shows as approved on Finished.
import { expect, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { assignments, submissions, tasks } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { reviewQueue } from '@/lib/review';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, feed, logIn, pairByCookie, tapDone } from './helpers';

const s = copy.submit;
const r = copy.review;
test.afterAll(closeDb);

test('send in, send back, send again, approve: the member, the lead and the Finished list all agree', async ({ browser }) => {
  const actor = await captainId();
  const member = await addMember(db(), { firstName: 'Loop', lastName: 'Person' }, null);
  const task = await createTask(db(), { title: 'Loop job', audience: 'person', memberIds: [member.id], steps: ['Bolt the left side', 'Bolt the right side'] }, actor);
  await publishTask(db(), task.id, actor);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberPage = await phone.newPage();
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const leadPage = await desk.newPage();
  await logIn(leadPage);

  // The member sends it in with a note and a link.
  await memberPage.goto(`/m/${member.pageKey}`);
  const card = memberPage.locator('article[data-testid="task"]', { hasText: 'Loop job' });
  await card.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
  await memberPage.getByLabel(s.noteLabel).fill('Bolted both sides');
  await memberPage.getByLabel(s.linkLabel).fill('https://example.org/loop');
  await memberPage.getByRole('button', { name: s.send }).click();
  await expect(memberPage.locator('article[data-testid="task"]', { hasText: 'Loop job' })).toHaveCount(0);
  await expect(memberPage.getByTestId('sent-in').locator('li[data-state="waiting"]')).toContainText('Loop job');

  // The lead sees it, with the whole name, the note and the link, and sends it back.
  await leadPage.goto('/dashboard/review');
  const waiting = leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop job' });
  await expect(waiting).toContainText('Loop Person');
  await expect(waiting.getByTestId('review-note')).toHaveText('Bolted both sides');
  await expect(waiting.getByTestId('review-link')).toContainText('https://example.org/loop');
  await expect(waiting).toContainText(r.viaMemberPage);
  await waiting.getByLabel(r.commentLabel).fill('The right side is loose');
  await waiting.getByRole('button', { name: `${r.sendBack}: Loop job`, exact: true }).click();
  await expect(leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop job' })).toHaveCount(0);

  // The member sees the comment on the task, fixes it and sends it again.
  await memberPage.reload();
  const again = memberPage.locator('article[data-testid="task"]', { hasText: 'Loop job' });
  await expect(again).toContainText('The right side is loose');
  await expect(again).toContainText(s.sentBackChip);
  await again.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
  await memberPage.getByLabel(s.noteLabel).fill('Tightened it');
  await memberPage.getByRole('button', { name: s.send }).click();
  await expect(memberPage.locator('article[data-testid="task"]', { hasText: 'Loop job' })).toHaveCount(0);

  // The lead approves. It leaves the queue and Finished says who approved it.
  await leadPage.reload();
  const second = leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop job' });
  await expect(second.getByTestId('review-note')).toHaveText('Tightened it');
  await expect(second.getByTestId('review-round')).toContainText(r.secondTry(2));
  await expect(second.getByTestId('review-round')).toContainText('The right side is loose');
  await second.getByRole('button', { name: `${r.approve}: Loop job`, exact: true }).click();
  await expect(leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop job' })).toHaveCount(0);
  await leadPage.goto('/dashboard/finished');
  const finished = leadPage.getByTestId('finished-row').filter({ hasText: 'Loop job' });
  await expect(finished.getByTestId('approved-chip')).toBeVisible();
  await expect(finished.getByTestId('approved-line')).toContainText('Test Captain');

  // The member's page agrees: one line for this work, as it stands now. The record keeps both rounds.
  await memberPage.reload();
  const mine = memberPage.getByTestId('sent-in').locator('li', { hasText: 'Loop job' });
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute('data-state', 'approved');
  const [handout] = await db().select().from(assignments).where(eq(assignments.taskId, task.id));
  expect(handout.state).toBe('approved');
  const rounds = await db().select().from(submissions).where(eq(submissions.assignmentId, handout.id));
  expect(rounds.map((x) => x.decision).sort()).toEqual(['approved', 'sent_back']);
  expect(rounds.every((x) => x.reviewedById === actor)).toBe(true);

  await phone.close();
  await desk.close();
});

test('Done on the kiosk for a task that needs a check sends it to the queue with no note; a chore with the check off is done at once', async ({ browser }) => {
  const actor = await captainId();
  const member = await addMember(db(), { firstName: 'Kiosk', lastName: 'Looper' }, null);
  const checked = await createTask(db(), { title: 'Loop wall checked job', audience: 'person', memberIds: [member.id] }, actor);
  const chore = await createTask(db(), { title: 'Loop wall chore job', audience: 'person', memberIds: [member.id], needsCheck: false }, actor);
  await publishTask(db(), checked.id, actor);
  await publishTask(db(), chore.id, actor);

  const wall = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  await pairByCookie(wall, 'Loop kiosk');
  const kiosk = await wall.newPage();
  await kiosk.goto('/kiosk');
  await feed(kiosk, member.scanCode);
  await expect(kiosk.getByRole('heading', { name: copy.kiosk.hello('Kiosk') })).toBeVisible();
  await tapDone(kiosk.locator('article[data-testid="task"]', { hasText: 'Loop wall checked job' }));
  await expect(kiosk.getByText(s.kioskWaiting)).toBeVisible();
  await tapDone(kiosk.locator('article[data-testid="task"]', { hasText: 'Loop wall chore job' }));
  await expect(kiosk.locator('article[data-testid="task"]', { hasText: 'Loop wall chore job' })).toHaveCount(0);

  const stateOf = async (taskId: string) => (await db().select().from(assignments).where(eq(assignments.taskId, taskId)))[0].state;
  expect(await stateOf(checked.id)).toBe('submitted');
  expect(await stateOf(chore.id)).toBe('done');

  // One piece of waiting work, with one note row, however many taps it took.
  const queued = (await reviewQueue(db())).filter((row) => row.title === 'Loop wall checked job');
  expect(queued.map((row) => ({ member: row.member, note: row.note, via: row.via }))).toEqual([{ member: 'Kiosk Looper', note: '', via: 'kiosk' }]);

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const leadPage = await desk.newPage();
  await logIn(leadPage);
  await leadPage.goto('/dashboard/review');
  const waiting = leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop wall checked job' });
  await expect(waiting).toContainText(r.viaKiosk);
  await expect(waiting).toContainText(r.noNote);
  await expect(leadPage.locator('[data-testid="review-card"]', { hasText: 'Loop wall chore job' })).toHaveCount(0);
  // The chore is on Finished without having gone through the queue.
  await leadPage.goto('/dashboard/finished');
  await expect(leadPage.getByTestId('finished-row').filter({ hasText: 'Loop wall chore job' })).toBeVisible();
  const [row] = await db().select().from(tasks).where(eq(tasks.id, chore.id));
  expect(row.needsCheck).toBe(false);
  await wall.close();
  await desk.close();
});

test('a lead cannot approve their own work on the Review screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const actor = await captainId();
  const task = await createTask(db(), { title: 'Captain own job', audience: 'person', memberIds: [actor] }, actor);
  await publishTask(db(), task.id, actor);
  const [handout] = await db().select().from(assignments).where(eq(assignments.taskId, task.id));
  const { submitWork } = await import('@/lib/submit');
  const { chicagoDay } = await import('@/lib/day');
  await submitWork(db(), { taskId: task.id, assignmentId: handout.id, memberId: actor, note: 'my own', link: '', via: 'member_page', today: chicagoDay(new Date()) });
  await logIn(page);
  await page.goto('/dashboard/review');
  const card = page.locator('[data-testid="review-card"]', { hasText: 'Captain own job' });
  await card.getByRole('button', { name: `${r.approve}: Captain own job`, exact: true }).click();
  await expect(card.getByTestId('review-problem')).toHaveText(r.ownWork);
  const [after] = await db().select().from(assignments).where(eq(assignments.id, handout.id));
  expect(after.state).toBe('submitted');
});
