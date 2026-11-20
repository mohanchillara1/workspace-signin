// Browser checks for what the phase 1 review found.
import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { acceptInvite, createInvite } from '@/lib/auth/leads';
import { copy } from '@/lib/copy';
import { addDays, chicagoDay } from '@/lib/day';
import { members } from '@/lib/db/schema';
import { addMember, addSubteam } from '@/lib/members';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, feed, logIn, pairByCookie, state } from './helpers';

const k = copy.kiosk;
test.afterAll(closeDb);

test('logging out ends the session: a copied cookie no longer opens the dashboard', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await logIn(page);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'lead')?.httpOnly).toBe(true);
  await page.getByRole('button', { name: copy.nav.logout }).click();
  await page.waitForURL('**/login');
  const thief = await browser.newContext();
  await thief.addCookies(cookies);
  const stolen = await thief.newPage();
  await stolen.goto('/dashboard');
  expect(stolen.url()).toContain('/login');
  await thief.close();
});

test('a lead who is not a captain gets no buttons on a captain or another lead', async ({ browser }) => {
  const now = new Date();
  const lead = await addMember(db(), { firstName: 'Plain', lastName: 'Lead', role: 'lead' }, null);
  await addMember(db(), { firstName: 'Other', lastName: 'Lead', role: 'lead' }, null);
  const token = await createInvite(db(), { memberId: lead.id, actorId: null, now, bootstrap: true });
  await acceptInvite(db(), { token, loginName: 'plainlead', password: 'a long enough password', now });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel(copy.login.name).fill('plainlead');
  await page.getByLabel(copy.login.password).fill('a long enough password');
  await page.getByRole('button', { name: copy.login.submit }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/dashboard/members');
  for (const name of ['Test Captain', 'Other Lead']) {
    const row = page.locator(`[data-member-name="${name}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(0);
  }
  // Their own row: a new code, yes; switching themselves off, no.
  const own = page.locator('[data-member-name="Plain Lead"]');
  await expect(own.getByRole('button', { name: copy.members.newCode })).toBeVisible();
  await expect(own.getByRole('button', { name: copy.members.deactivate })).toHaveCount(0);
  await context.close();
});

test('words in a link cannot be put on the Members screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await logIn(page);
  await page.goto('/dashboard/members?problem=Your%20account%20is%20locked.%20Call%20555-0100');
  await expect(page.getByText('555-0100')).toHaveCount(0);
  // The framework has an alert region of its own, so ask for the page's.
  await expect(page.locator('p[role="alert"]')).toHaveText(copy.members.problem(copy.errors.generic));
});

test('junk ids get a plain answer, not a server error', async ({ context, page }) => {
  await pairByCookie(context);
  const member = await addMember(db(), { firstName: 'Junk', lastName: 'Ids' }, null);
  await page.goto('/kiosk');
  const probes: [string, Record<string, unknown>][] = [
    ['/api/kiosk/done', { code: member.scanCode, taskId: 'nope' }],
    ['/api/kiosk/done', { code: member.scanCode, taskId: '00000000-0000-4000-8000-000000000000', assignmentId: 'x' }],
    ['/api/kiosk/claim', { code: member.scanCode, taskId: "x' or '1'='1" }],
    ['/api/kiosk/giveback', { code: member.scanCode, assignmentId: 42 }],
  ];
  for (const [path, data] of probes) {
    const response = await page.request.post(path, { data });
    expect(response.status(), path).toBe(200);
  }
  await logIn(page);
  expect((await page.request.get('/dashboard/tasks/not-a-task')).status()).toBe(404);
});

test('the kiosk gives up on a request that never answers, and says so when the server cannot do its job', async ({ context, page }) => {
  test.setTimeout(70_000);
  const member = await addMember(db(), { firstName: 'Slow', lastName: 'Server' }, null);
  await pairByCookie(context);
  await page.goto('/kiosk');
  // The server answers "cannot do it": the kiosk shows the no-connection message and stays there.
  await page.route('**/api/kiosk/scan', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"status":"error"}' }));
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.offlineTitle })).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-phase', 'offline');
  await page.unroute('**/api/health');
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-phase', 'idle', { timeout: 10_000 });
  // A request that never answers at all.
  await page.unroute('**/api/kiosk/scan');
  await page.route('**/api/kiosk/scan', () => {
    /* never answered */
  });
  await page.waitForTimeout(2200);
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.offlineTitle })).toBeVisible({ timeout: 12_000 });
  await page.unroute('**/api/kiosk/scan');
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-phase', 'idle', { timeout: 10_000 });
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Slow') })).toBeVisible();
});

test('on the kiosk a member can put a task back, and the "more below" tag never covers a task', async ({ context, page }) => {
  const actor = await captainId();
  const member = await addMember(db(), { firstName: 'Many', lastName: 'Tasks' }, null);
  for (let i = 1; i <= 9; i++) {
    const task = await createTask(db(), { title: `Long list job ${i}`, audience: 'person', memberIds: [member.id], steps: ['One', 'Two'] }, actor);
    await publishTask(db(), task.id, actor);
  }
  const pool = await createTask(db(), { title: 'Take then put back', audience: 'pool' }, actor);
  await publishTask(db(), pool.id, actor);
  await pairByCookie(context);
  await page.goto('/kiosk');
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Many') })).toBeVisible();
  await expect(page.getByTestId('more-below')).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const tag = document.querySelector('[data-testid="more-below"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('article[data-testid="task"]')].some((card) => {
      // Only the part of a card that is on screen counts: the list scrolls
      // inside its own box, and what is scrolled out of it is not drawn.
      const box = card.closest('.overflow-y-auto')!.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const top = Math.max(c.top, box.top);
      const bottom = Math.min(c.bottom, box.bottom);
      return bottom > top && tag.left < c.right && tag.right > c.left && tag.top < bottom && tag.bottom > top;
    });
  });
  expect(overlaps).toBe(false);

  const card = page.locator('article[data-testid="task"]', { hasText: 'Take then put back' });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: k.take }).click();
  const mine = page.locator('section[data-group="yours"] article', { hasText: 'Take then put back' });
  await mine.getByRole('button', { name: k.putBack }).click();
  await expect(page.locator('section[data-group="pool"]')).toContainText('Take then put back');
  // One tap on Done does not finish a task.
  const first = page.locator('article[data-testid="task"]', { hasText: 'Long list job 1' }).first();
  await first.scrollIntoViewIfNeeded();
  await first.getByRole('button', { name: k.done, exact: true }).click();
  await expect(first.getByRole('button', { name: k.confirmDone })).toBeVisible();
  await expect(page.getByText('Long list job 1', { exact: true })).toBeVisible();
});

test('the roster takes a CSV file with a header row and quotes, and a second upload adds nobody twice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await logIn(page);
  await addSubteam(db(), 'Build');
  const file = '.e2e/roster.csv';
  writeFileSync(file, 'Name,Subteam\r\n"Upload One",Build\r\nUpload,Two,Build\r\n"Upload Three","Upload Crew"\r\n');
  for (const expected of [copy.members.rosterResult(3, 0, 0), copy.members.rosterResult(0, 0, 3)]) {
    await page.goto('/dashboard/members');
    await page.getByLabel(copy.members.rosterFile).setInputFiles(file);
    await page.getByRole('button', { name: copy.members.rosterSubmit }).click();
    await expect(page.getByRole('status')).toHaveText(expected);
  }
  await expect(page.locator('[data-member-name="Upload Three"]')).toContainText('Upload Crew');
  expect(await db().select().from(members).where(eq(members.firstName, 'Name'))).toHaveLength(0);
  expect(await db().select().from(members).where(and(eq(members.firstName, 'Upload'), eq(members.lastName, 'Two')))).toHaveLength(1);
  // A subteam made by mistake can be removed while nothing uses it.
  await page.getByLabel(copy.members.subteamName).fill('Typo Crew');
  await page.getByRole('button', { name: copy.members.subteamAdd }).click();
  const typo = page.locator('[data-subteam="Typo Crew"]');
  await typo.getByRole('button', { name: copy.members.subteamRemove('Typo Crew') }).click();
  await expect(typo).toHaveCount(0);
  await expect(page.locator('[data-subteam="Build"]').getByRole('button')).toHaveCount(0);
});

test("leads see overdue tasks marked, and the day's hand changes listed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const actor = await captainId();
  const member = await addMember(db(), { firstName: 'Over', lastName: 'Due' }, null);
  const today = chicagoDay(new Date());
  const task = await createTask(db(), { title: 'Late job for the list', audience: 'person', memberIds: [member.id], dueDay: addDays(today, -2) }, actor);
  await publishTask(db(), task.id, actor);
  await logIn(page);
  await page.goto('/dashboard/tasks');
  await expect(page.locator('li', { hasText: 'Late job for the list' }).getByText(copy.tasks.overdue, { exact: true })).toBeVisible();
  await page.goto('/dashboard/attendance');
  await page.locator('[data-member-name="Over Due"]').getByRole('button', { name: copy.attendance.markHere }).click();
  await page.locator('[data-member-name="Over Due"]').getByRole('button', { name: copy.attendance.remove }).click();
  const changes = page.getByTestId('changes');
  await expect(changes).toContainText('Test Captain marked Over Due here at');
  await expect(changes).toContainText('Test Captain unmarked Over Due at');
});

test('on a phone the dashboard links fold behind one Menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page);
  await expect(page.getByRole('link', { name: copy.nav.members })).toHaveCount(0);
  await page.getByRole('button', { name: copy.nav.menu }).click();
  await page.getByRole('link', { name: copy.nav.members }).click();
  await page.waitForURL('**/dashboard/members');
  await expect(page.getByRole('link', { name: copy.nav.members })).toHaveCount(0);
  // The bar itself stays one row tall. (The test server is a test copy, so
  // its tag sits in a row of its own above the bar; 09-test-copy checks that.)
  expect(await page.evaluate(() => document.querySelector('[data-testid="nav-bar"]')!.getBoundingClientRect().height)).toBeLessThan(90);
});

test('security headers: no framework banner, a content policy and strict transport', async ({ request }) => {
  const response = await request.get(`${state().baseUrl}/login`);
  const headers = response.headers();
  expect(headers['x-powered-by']).toBeUndefined();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
});
