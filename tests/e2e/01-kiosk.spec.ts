import { expect, test } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { assignments, attendance } from '@/lib/db/schema';
import { addMember, addSubteam } from '@/lib/members';
import { createTask, publishTask } from '@/lib/tasks';
import { captainId, closeDb, db, feed, logIn, pairByCookie, watchConsole } from './helpers';

const k = copy.kiosk;
const kiosk = (page: import('@playwright/test').Page) => page.getByTestId('kiosk');

test.afterAll(closeDb);

test('an unpaired browser cannot use the scan page or its routes', async ({ page, request }) => {
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: k.notPairedTitle })).toBeVisible();
  const response = await request.post('/api/kiosk/scan', { data: { code: 'SR1-00000000000000000000000000' } });
  expect(response.status()).toBe(401);
  for (const path of ['/api/kiosk/claim', '/api/kiosk/done', '/api/kiosk/hello']) {
    expect((await request.post(path, { data: {} })).status()).toBe(401);
  }
});

test('a member with no task and an empty pool is told to find a lead', async ({ page, context }) => {
  const member = await addMember(db(), { firstName: 'Nothing', lastName: 'Person' }, null);
  await pairByCookie(context);
  await page.goto('/kiosk');
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Nothing') })).toBeVisible();
  await expect(page.getByText(k.nothingTitle)).toBeVisible();
  await expect(page.getByText(k.nothingBody)).toBeVisible();
});

test('a lead pairs the device from the dashboard and is logged out on it', async ({ page }) => {
  await logIn(page);
  await page.goto('/dashboard/kiosk');
  await page.getByLabel(copy.kioskAdmin.name).fill('Wall iPad');
  await page.getByRole('button', { name: copy.kioskAdmin.pair }).click();
  await page.waitForURL('**/kiosk');
  await expect(page.getByRole('heading', { name: k.idleTitle })).toBeVisible();
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
});

test('a scan signs the member in once and shows their tasks in order', async ({ page, context }) => {
  const errors = watchConsole(page);
  const actor = await captainId();
  const subteam = await addSubteam(db(), 'Kiosk Crew');
  const member = await addMember(db(), { firstName: 'Kiosk', lastName: 'Tester', subteamId: subteam.id }, null);
  for (const input of [
    { title: 'Pool job for the kiosk test', audience: 'pool' as const },
    { title: 'Crew job', audience: 'subteam' as const, subteamId: subteam.id },
    { title: 'Own job', audience: 'person' as const, memberIds: [member.id], steps: ['First step', 'Second step'] },
  ]) {
    const task = await createTask(db(), input, actor);
    await publishTask(db(), task.id, actor);
  }
  await pairByCookie(context);
  let scanRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/kiosk/scan')) scanRequests++;
  });
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle');

  // The decoder reads every frame, so the same code arrives many times.
  for (let i = 0; i < 5; i++) await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Kiosk') })).toBeVisible();
  await expect(page.getByText(k.signedIn, { exact: true })).toBeVisible();
  const groups = await page.locator('section[data-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-group')));
  expect(groups).toEqual(['yours', 'subteam', 'pool']);
  await expect(page.locator('section[data-group="yours"]')).toContainText('Own job');
  await expect(page.locator('section[data-group="subteam"]')).toContainText('Crew job');
  await expect(page.locator('section[data-group="pool"]')).toContainText('Pool job for the kiosk test');
  expect(scanRequests).toBe(1);

  const today = chicagoDay(new Date());
  const rows = () => db().select().from(attendance).where(and(eq(attendance.memberId, member.id), eq(attendance.day, today)));
  expect(await rows()).toHaveLength(1);

  // Tapping a task shows its steps.
  await page.getByRole('button', { name: 'Own job' }).click();
  await expect(page.getByText('Second step')).toBeVisible();

  // Taking a pool task moves it to "Yours"; Done removes it.
  const pool = page.locator('article[data-testid="task"]', { hasText: 'Pool job for the kiosk test' });
  await pool.getByRole('button', { name: k.take }).click();
  await expect(page.locator('section[data-group="yours"]')).toContainText('Pool job for the kiosk test');
  await page.locator('section[data-group="yours"] article', { hasText: 'Pool job for the kiosk test' }).getByRole('button', { name: k.done }).click();
  await expect(page.getByText('Pool job for the kiosk test')).toHaveCount(0);
  const done = await db().select().from(assignments).where(and(eq(assignments.doneById, member.id), eq(assignments.state, 'done')));
  expect(done).toHaveLength(1);
  expect(done[0].doneVia).toBe('kiosk');

  // The status line says the kiosk is alive and when it last read a code.
  await expect(page.getByTestId('kiosk-status')).toContainText(k.statusOnline);
  await expect(page.getByTestId('kiosk-status')).toContainText(k.statusLastRead('|').split('|')[0].trim());

  // Back to the start after 3 s without a touch (the test server's setting).
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle', { timeout: 7000 });

  // A second scan the same day shows the tasks again and adds no row.
  await page.waitForTimeout(2200);
  await feed(page, member.scanCode);
  await expect(page.getByText(k.signedInAgain, { exact: true })).toBeVisible();
  expect(await rows()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a touch restarts the clock before the screen goes back', async ({ page, context }) => {
  const member = await addMember(db(), { firstName: 'Touch', lastName: 'Person' }, null);
  await pairByCookie(context);
  await page.goto('/kiosk');
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Touch') })).toBeVisible();
  await page.waitForTimeout(2000);
  await page.getByRole('heading', { name: k.hello('Touch') }).click();
  await page.waitForTimeout(2000);
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'hello');
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle', { timeout: 5000 });
});

test('an unknown code gets a plain message', async ({ page, context }) => {
  await pairByCookie(context);
  await page.goto('/kiosk');
  await feed(page, 'https://example.com/not-ours');
  await expect(page.getByRole('heading', { name: k.unknownTitle })).toBeVisible();
  await expect(page.getByText(k.unknownBody)).toBeVisible();
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle', { timeout: 7000 });
});

test('with no connection the kiosk says so, and scans again once it is back', async ({ page, context }) => {
  const member = await addMember(db(), { firstName: 'Offline', lastName: 'Person' }, null);
  await pairByCookie(context);
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle');
  await context.setOffline(true);
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.offlineTitle })).toBeVisible();
  await expect(page.getByTestId('kiosk-status')).toContainText(k.statusOffline);
  const today = chicagoDay(new Date());
  expect(await db().select().from(attendance).where(and(eq(attendance.memberId, member.id), eq(attendance.day, today)))).toHaveLength(0);
  await context.setOffline(false);
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle', { timeout: 10000 });
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.hello('Offline') })).toBeVisible();
});

test('a kiosk that a lead turned off stops working on the next scan', async ({ page, context }) => {
  const { unpairKiosk } = await import('@/lib/kiosk');
  const member = await addMember(db(), { firstName: 'Late', lastName: 'Person' }, null);
  const id = await pairByCookie(context);
  await page.goto('/kiosk');
  await expect(kiosk(page)).toHaveAttribute('data-phase', 'idle');
  await unpairKiosk(db(), id, await captainId());
  await feed(page, member.scanCode);
  await expect(page.getByRole('heading', { name: k.notPairedTitle })).toBeVisible();
});

test('the kiosk screen has no sideways scroll in portrait or landscape', async ({ page, context }) => {
  await pairByCookie(context);
  for (const size of [{ width: 1024, height: 1366 }, { width: 1366, height: 1024 }]) {
    await page.setViewportSize(size);
    await page.goto('/kiosk');
    await expect(page.getByRole('heading', { name: k.idleTitle })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
