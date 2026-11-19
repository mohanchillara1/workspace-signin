// Lane a: marking work done with a note and a link, and where each submission stands.
import { expect, test, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { assignments, submissions, type Member } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { submitWork } from '@/lib/submit';
import { createTask, openFor, publishTask, settleReview } from '@/lib/tasks';
import { captainId, closeDb, db, feed, pairByCookie, tapDone, watchConsole } from './helpers';

const s = copy.submit;
const TODAY = () => chicagoDay(new Date());

test.afterAll(closeDb);

// Set SHOTS_DIR to keep a picture of each screen. Nothing is written otherwise.
async function shot(page: Page, name: string) {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true });
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const card = (page: Page, title: string) => page.locator('article[data-testid="task"]', { hasText: title });

async function person(first: string, last: string) {
  return addMember(db(), { firstName: first, lastName: last }, null);
}
async function giveTask(member: Member, title: string, extra: { needsCheck?: boolean; steps?: string[] } = {}) {
  const actor = await captainId();
  const task = await createTask(db(), { title, audience: 'person', memberIds: [member.id], ...extra }, actor);
  await publishTask(db(), task.id, actor);
  const line = (await openFor(db(), member.id, TODAY())).find((h) => h.title === title)!;
  return { task, assignmentId: line.assignmentId! };
}
const rowsOf = (assignmentId: string) => db().select().from(submissions).where(eq(submissions.assignmentId, assignmentId));
const stateOf = async (assignmentId: string) => (await db().select().from(assignments).where(eq(assignments.id, assignmentId)))[0].state;

test.describe('the member page, on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('Done on a task that needs a check opens a form; sending it in puts it on the Sent in list, waiting', async ({ page }) => {
    const errors = watchConsole(page);
    const member = await person('Submit', 'Alpha');
    const { assignmentId } = await giveTask(member, 'Wire the claw', { steps: ['Strip the ends'] });
    await page.goto(`/m/${member.pageKey}`);
    await expect(page.getByTestId('sent-in')).toContainText(s.listNone);

    const wire = card(page, 'Wire the claw');
    await wire.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
    // A form, not the "tap again" step.
    await expect(wire.getByTestId('send-in-form')).toBeVisible();
    await expect(wire.getByRole('button', { name: copy.kiosk.confirmDone })).toHaveCount(0);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'member-390-form');

    await wire.getByLabel(s.noteLabel).fill('  I wired it. <b>Bold?</b> <script>alert(1)</script>  ');
    await wire.getByLabel(s.linkLabel).fill('https://example.org/claw');
    await wire.getByRole('button', { name: s.send }).click();

    await expect(page.getByTestId('send-result')).toHaveText(s.sentIn);
    await expect(card(page, 'Wire the claw')).toHaveCount(0);
    const list = page.getByTestId('sent-in');
    const item = list.locator('li', { hasText: 'Wire the claw' });
    await expect(item).toContainText(s.waiting);
    // The note is text: the tags show as typed and make no elements.
    await expect(item).toContainText('I wired it. <b>Bold?</b> <script>alert(1)</script>');
    expect(await item.locator('b, script').count()).toBe(0);
    const link = item.getByRole('link', { name: 'https://example.org/claw' });
    await expect(link).toHaveAttribute('href', 'https://example.org/claw');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'member-390-sent-in-waiting');

    expect(await stateOf(assignmentId)).toBe('submitted');
    const rows = await rowsOf(assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ note: 'I wired it. <b>Bold?</b> <script>alert(1)</script>', link: 'https://example.org/claw', via: 'member_page', decision: null });
    expect(errors).toEqual([]);
  });

  test('a link that is not https, or a note that is too long, is refused in words and nothing is saved', async ({ page }) => {
    const errors = watchConsole(page);
    const member = await person('Submit', 'Bravo');
    const { assignmentId } = await giveTask(member, 'Refused work');
    await page.goto(`/m/${member.pageKey}`);
    const work = card(page, 'Refused work');
    await work.getByRole('button', { name: copy.kiosk.done, exact: true }).click();

    for (const bad of ['javascript:alert(1)', 'http://example.org/plain', 'example.org']) {
      await work.getByLabel(s.linkLabel).fill(bad);
      await work.getByRole('button', { name: s.send }).click();
      await expect(work.getByRole('alert')).toHaveText(s.linkBad);
      expect(await rowsOf(assignmentId)).toHaveLength(0);
      expect(await stateOf(assignmentId)).toBe('open');
    }
    await shot(page, 'member-390-link-refused');
    await expect(card(page, 'Refused work')).toBeVisible();

    // The box itself stops typing at 500; the server is checked directly below.
    await work.getByLabel(s.noteLabel).fill('n'.repeat(600));
    expect((await work.getByLabel(s.noteLabel).inputValue()).length).toBe(500);

    // Fixing the link lets it through.
    await work.getByLabel(s.linkLabel).fill('https://example.org/fixed');
    await work.getByRole('button', { name: s.send }).click();
    await expect(page.getByTestId('send-result')).toHaveText(s.sentIn);
    expect(await rowsOf(assignmentId)).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('"Never mind" shuts the form and leaves the task alone', async ({ page }) => {
    const member = await person('Submit', 'Charlie');
    const { assignmentId } = await giveTask(member, 'Maybe later');
    await page.goto(`/m/${member.pageKey}`);
    const work = card(page, 'Maybe later');
    await work.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
    await work.getByRole('button', { name: s.cancel }).click();
    await expect(work.getByTestId('send-in-form')).toHaveCount(0);
    expect(await stateOf(assignmentId)).toBe('open');
  });

  test('a task with the check off keeps the two-tap Done and goes straight to done', async ({ page }) => {
    const member = await person('Submit', 'Delta');
    const { assignmentId } = await giveTask(member, 'Quick chore', { needsCheck: false });
    await page.goto(`/m/${member.pageKey}`);
    const chore = card(page, 'Quick chore');
    await expect(chore.getByText(copy.finished.needsCheck)).toHaveCount(0);
    await chore.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
    await expect(chore.getByTestId('send-in-form')).toHaveCount(0);
    await expect(chore.getByRole('button', { name: copy.kiosk.confirmDone })).toBeVisible();
    await chore.getByRole('button', { name: copy.kiosk.confirmDone }).click();
    await expect(card(page, 'Quick chore')).toHaveCount(0);
    expect(await stateOf(assignmentId)).toBe('done');
    expect(await rowsOf(assignmentId)).toHaveLength(0);
    await expect(page.getByTestId('send-result')).toHaveCount(0);
    await expect(page.getByTestId('sent-in').locator('li', { hasText: 'Quick chore' })).toHaveCount(0);
  });

  test('sent-back work shows the lead\'s comment on its card, can be sent in again, and the list keeps both rounds', async ({ page }) => {
    const errors = watchConsole(page);
    const member = await person('Submit', 'Echo');
    const lead = await captainId();
    const { task, assignmentId } = await giveTask(member, 'Redo the bracket');
    const first = await submitWork(db(), { taskId: task.id, assignmentId, memberId: member.id, note: 'first go', link: 'https://example.org/one', via: 'member_page', today: TODAY() });
    expect(first).toMatchObject({ ok: true, state: 'submitted' });
    await page.goto(`/m/${member.pageKey}`);
    await expect(page.getByTestId('sent-in').locator('li', { hasText: 'Redo the bracket' })).toContainText(s.waiting);

    // A lead sends it back with a comment that has HTML in it.
    await db().transaction(async (tx) => {
      await settleReview(tx, { assignmentId, decision: 'sent_back' });
      await tx.update(submissions).set({ decision: 'sent_back', comment: 'Needs <i>two</i> holes, not one.', reviewedById: lead, reviewedAt: new Date() }).where(eq(submissions.assignmentId, assignmentId));
    });
    await page.reload();
    const back = card(page, 'Redo the bracket');
    await expect(back.getByTestId('sent-back')).toContainText('Needs <i>two</i> holes, not one.');
    expect(await back.locator('i').count()).toBe(0);
    await expect(back.getByTestId('sent-back')).toContainText(s.sentBackHint);
    const listed = page.getByTestId('sent-in').locator('li', { hasText: 'Redo the bracket' });
    await expect(listed).toContainText(s.sentBack);
    await expect(listed).toContainText('Needs <i>two</i> holes, not one.');
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'member-390-sent-back');

    // Send it in again.
    await back.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
    await back.getByLabel(s.noteLabel).fill('second go');
    await back.getByRole('button', { name: s.send }).click();
    await expect(page.getByTestId('send-result')).toHaveText(s.sentIn);
    await expect(card(page, 'Redo the bracket')).toHaveCount(0);
    expect(await rowsOf(assignmentId)).toHaveLength(2);
    expect(await stateOf(assignmentId)).toBe('submitted');
    const both = page.getByTestId('sent-in').locator('li', { hasText: 'Redo the bracket' });
    await expect(both).toHaveCount(2);
    await expect(both.first()).toContainText(s.waiting);
    await expect(both.nth(1)).toContainText(s.sentBack);
    expect(errors).toEqual([]);
  });

  test('approved work shows as approved with the comment, and a link that is not https is never tappable', async ({ page }) => {
    const member = await person('Submit', 'Foxtrot');
    const lead = await captainId();
    const { task, assignmentId } = await giveTask(member, 'Approved piece');
    await submitWork(db(), { taskId: task.id, assignmentId, memberId: member.id, note: 'all done', link: 'https://example.org/ok', via: 'member_page', today: TODAY() });
    await db().transaction(async (tx) => {
      await settleReview(tx, { assignmentId, decision: 'approved' });
      await tx.update(submissions).set({ decision: 'approved', comment: 'Looks good.', reviewedById: lead, reviewedAt: new Date() }).where(eq(submissions.assignmentId, assignmentId));
    });
    // A row with a link that could only get here by another route.
    const other = await giveTask(member, 'Odd link piece');
    await db().update(assignments).set({ state: 'submitted' }).where(eq(assignments.id, other.assignmentId));
    await db().insert(submissions).values({ assignmentId: other.assignmentId, memberId: member.id, note: '', link: 'javascript:alert(1)', via: 'member_page' });

    await page.goto(`/m/${member.pageKey}`);
    const done = page.getByTestId('sent-in').locator('li', { hasText: 'Approved piece' });
    await expect(done).toContainText(s.approved);
    await expect(done).toContainText('Looks good.');
    await expect(card(page, 'Approved piece')).toHaveCount(0);
    const odd = page.getByTestId('sent-in').locator('li', { hasText: 'Odd link piece' });
    await expect(odd).toContainText('javascript:alert(1)');
    expect(await odd.locator('a').count()).toBe(0);
    await shot(page, 'member-390-approved');
  });

  test('the Sent in list and the form fit at 1440 wide too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const member = await person('Submit', 'Golf');
    await giveTask(member, 'Wide screen job');
    await page.goto(`/m/${member.pageKey}`);
    await card(page, 'Wide screen job').getByRole('button', { name: copy.kiosk.done, exact: true }).click();
    await expect(page.getByTestId('send-in-form')).toBeVisible();
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'member-1440-form');
  });
});

test.describe('the kiosk', () => {
  test('Done on a task that needs a check is two taps with no note, and the kiosk says it is waiting', async ({ page, context }) => {
    const errors = watchConsole(page);
    const member = await person('Submit', 'Kiosk');
    const { assignmentId } = await giveTask(member, 'Kiosk checked job');
    const plain = await giveTask(member, 'Kiosk plain job', { needsCheck: false });
    await pairByCookie(context, 'Submit test kiosk');
    await page.goto('/kiosk');
    await feed(page, member.scanCode);
    await expect(page.getByRole('heading', { name: copy.kiosk.hello('Submit') })).toBeVisible();
    await shot(page, 'kiosk-1024x1366-before');

    // Two taps. No form on the kiosk.
    await tapDone(card(page, 'Kiosk checked job'));
    await expect(page.getByText('Kiosk checked job')).toHaveCount(0);
    await expect(page.getByTestId('kiosk-note')).toHaveText(s.kioskWaiting);
    await shot(page, 'kiosk-1024x1366-waiting');
    expect(await stateOf(assignmentId)).toBe('submitted');
    const rows = await rowsOf(assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ note: '', link: '', via: 'kiosk', memberId: member.id });

    // A task with no check finishes with no such message and no row.
    await tapDone(card(page, 'Kiosk plain job'));
    await expect(page.getByText('Kiosk plain job')).toHaveCount(0);
    await expect(page.getByTestId('kiosk-note')).toHaveCount(0);
    expect(await stateOf(plain.assignmentId)).toBe('done');
    expect(await rowsOf(plain.assignmentId)).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test('the kiosk shows a sent-back task with the lead\'s comment, and the same two taps send it in again', async ({ page, context }) => {
    const member = await person('Submit', 'Hotel');
    const lead = await captainId();
    const { task, assignmentId } = await giveTask(member, 'Kiosk redo job');
    await submitWork(db(), { taskId: task.id, assignmentId, memberId: member.id, note: 'x', link: '', via: 'kiosk', today: TODAY() });
    await db().transaction(async (tx) => {
      await settleReview(tx, { assignmentId, decision: 'sent_back' });
      await tx.update(submissions).set({ decision: 'sent_back', comment: 'Label the wires.', reviewedById: lead, reviewedAt: new Date() }).where(eq(submissions.assignmentId, assignmentId));
    });
    await pairByCookie(context, 'Submit sent-back kiosk');
    await page.setViewportSize({ width: 1366, height: 1024 });
    await page.goto('/kiosk');
    await feed(page, member.scanCode);
    const redo = card(page, 'Kiosk redo job');
    await expect(redo.getByTestId('sent-back')).toContainText('Label the wires.');
    await shot(page, 'kiosk-1366x1024-sent-back');
    await tapDone(redo);
    await expect(page.getByTestId('kiosk-note')).toHaveText(s.kioskWaiting);
    expect(await rowsOf(assignmentId)).toHaveLength(2);
    expect(
      await db().select().from(assignments).where(and(eq(assignments.id, assignmentId), eq(assignments.state, 'submitted'))),
    ).toHaveLength(1);
  });

  test('the kiosk route refuses a hand-out that is not for the person who scanned', async ({ page, context }) => {
    const owner = await person('Submit', 'India');
    const other = await person('Submit', 'Juliet');
    const { task, assignmentId } = await giveTask(owner, 'Not yours job');
    await pairByCookie(context, 'Submit wrong-person kiosk');
    await page.goto('/kiosk');
    const reply = await page.request.post('/api/kiosk/done', { data: { code: other.scanCode, taskId: task.id, assignmentId } });
    expect(await reply.json()).toMatchObject({ status: 'ok', changed: false });
    expect(await rowsOf(assignmentId)).toHaveLength(0);
    expect(await stateOf(assignmentId)).toBe('open');
  });
});
