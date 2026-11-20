import { expect, test, type Page } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { copy } from '@/lib/copy';
import { chicagoDay } from '@/lib/day';
import { assignments, members, tasks } from '@/lib/db/schema';
import { addMember } from '@/lib/members';
import { closeDb, db, feed, logIn, pairByCookie, state, tapDone, watchConsole } from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });
test.afterAll(closeDb);

const memberNamed = async (firstName: string, lastName: string) => {
  const [row] = await db().select().from(members).where(and(eq(members.firstName, firstName), eq(members.lastName, lastName)));
  return row;
};

async function newTask(page: Page, title: string, fill: (page: Page) => Promise<void>) {
  await page.goto('/dashboard/tasks/new');
  await page.getByLabel(copy.tasks.fieldTitle).fill(title);
  await fill(page);
  await page.getByRole('button', { name: copy.tasks.publish }).click();
  await expect(page.getByText(copy.tasks.published)).toBeVisible();
}

test('the dashboard needs a login, and a wrong password gets a plain answer', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
  await page.getByLabel(copy.login.name).fill(state().captain.loginName);
  await page.getByLabel(copy.login.password).fill('not the password');
  await page.getByRole('button', { name: copy.login.submit }).click();
  await expect(page.getByText(copy.login.wrong)).toBeVisible();
  for (const path of ['/dashboard/members', '/dashboard/attendance/export?from=2026-01-01&to=2026-12-31']) {
    const response = await page.goto(path);
    expect(page.url()).toContain('/login');
    expect(await response?.text()).not.toContain('first name');
  }
});

test('a lead adds a member and tasks, sees who is here, corrects by hand, exports, and reopens', async ({ page, browser }) => {
  const errors = watchConsole(page);
  await logIn(page);

  // Add a member.
  await page.goto('/dashboard/members');
  await page.getByLabel(copy.members.firstName, { exact: true }).fill('Dash');
  await page.getByLabel(copy.members.lastName, { exact: true }).fill('Board');
  await page.getByLabel(copy.members.subteam, { exact: true }).selectOption({ label: 'Build' });
  await page.getByRole('button', { name: copy.members.add }).click();
  await expect(page.locator('[data-member-name="Dash Board"]')).toBeVisible();
  const dash = await memberNamed('Dash', 'Board');
  const idle = await addMember(db(), { firstName: 'Idle', lastName: 'Hands' }, null);
  const away = await addMember(db(), { firstName: 'Away', lastName: 'Today' }, null);

  // A task for a person, one for a subteam, one for the pool.
  await newTask(page, 'Dash own job', async (p) => {
    await p.getByLabel(copy.tasks.audiencePerson).check();
    await p.getByLabel('Dash Board').check();
    await p.getByLabel(copy.tasks.fieldNeedsCheck).uncheck();
  });
  await newTask(page, 'Build crew job', async (p) => {
    await p.getByLabel(copy.tasks.audienceSubteam).check();
    await p.getByLabel(copy.tasks.fieldSubteam, { exact: true }).selectOption({ label: 'Build' });
  });
  await newTask(page, 'Dashboard pool job', async (p) => {
    await p.getByLabel(copy.tasks.audiencePool).check();
  });

  // The kiosk shows all three to that member.
  const kioskContext = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  await pairByCookie(kioskContext, 'Dashboard test kiosk');
  const kiosk = await kioskContext.newPage();
  await kiosk.goto('/kiosk');
  await feed(kiosk, dash.scanCode);
  await expect(kiosk.getByRole('heading', { name: copy.kiosk.hello('Dash') })).toBeVisible();
  for (const title of ['Dash own job', 'Build crew job', 'Dashboard pool job']) {
    await expect(kiosk.getByText(title)).toBeVisible();
  }
  await tapDone(kiosk.locator('article[data-testid="task"]', { hasText: 'Dash own job' }));
  await expect(kiosk.getByText('Dash own job')).toHaveCount(0);
  await expect(kiosk.getByTestId('kiosk')).toHaveAttribute('data-phase', 'idle', { timeout: 7000 });
  await feed(kiosk, idle.scanCode);
  await expect(kiosk.getByRole('heading', { name: copy.kiosk.hello('Idle') })).toBeVisible();
  await kioskContext.close();

  // Today: here, here with nothing to do, not here.
  await page.goto('/dashboard');
  await expect(page.locator('section[data-list="here"]')).toContainText('Dash Board');
  await expect(page.locator('section[data-list="here-nothing"]')).toContainText('Idle Hands');
  await expect(page.locator('section[data-list="here-nothing"]')).not.toContainText('Dash Board');
  await expect(page.locator('section[data-list="not-here"]')).toContainText('Away Today');

  // Tasks: the line about members with no open task.
  await page.goto('/dashboard/tasks');
  await expect(page.getByTestId('no-task-line')).toContainText(/\d+ active members? ha(s|ve) no task\./);
  await expect(page.getByText('Dashboard pool job')).toBeVisible();

  // Attendance: a by-hand row shows who made it.
  await page.goto('/dashboard/attendance');
  await page.locator('[data-member-name="Away Today"]').getByRole('button', { name: copy.attendance.markHere }).click();
  await expect(page.locator('[data-member-name="Away Today"]')).toContainText(copy.attendance.byHand('Test Captain'));

  // The CSV has the header and the member's row.
  const today = chicagoDay(new Date());
  const csv = await page.request.get(`/dashboard/attendance/export?from=${today}&to=${today}`);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text.split('\r\n')[0]).toBe(copy.attendance.csvHeaders.join(','));
  expect(text).toMatch(new RegExp(`${today},Dash,Board,Build,[^,]+,kiosk,\\r\\n`));
  expect(text).toMatch(new RegExp(`${today},Away,Today,,[^,]+,by hand,Test Captain\\r\\n`));

  // Finished lists the done task; Reopen puts it back.
  await page.goto('/dashboard/finished');
  const row = page.getByTestId('finished-row').filter({ hasText: 'Dash own job' });
  await expect(row).toContainText('Dash Board');
  await row.getByRole('button', { name: copy.finished.reopen }).click();
  await expect(page.getByTestId('finished-row').filter({ hasText: 'Dash own job' })).toHaveCount(0);
  const [task] = await db().select().from(tasks).where(eq(tasks.title, 'Dash own job'));
  const [handout] = await db().select().from(assignments).where(eq(assignments.taskId, task.id));
  expect(handout.state).toBe('open');
  expect(errors).toEqual([]);
});

test('members: deactivate, new code, roster paste, print sheet', async ({ page }) => {
  await logIn(page);
  const target = await addMember(db(), { firstName: 'Row', lastName: 'Actions' }, null);
  await page.goto('/dashboard/members');
  // The board shows people; their buttons are on their own page.
  await page.locator('[data-member-name="Row Actions"]').click();
  await page.waitForURL(`**/dashboard/members/${target.id}`);
  await expect(page.getByTestId('member-qr')).toBeVisible();
  await expect(page.getByTestId('scan-code')).toHaveText(target.scanCode);
  const row = page.locator('[data-member-name="Row Actions"]');
  await row.getByRole('button', { name: copy.members.newCode }).click();
  await expect.poll(async () => (await memberNamed('Row', 'Actions')).scanCode).not.toBe(target.scanCode);
  await row.getByRole('button', { name: copy.members.deactivate }).click();
  await expect(row).toContainText(copy.members.inactive);
  expect((await memberNamed('Row', 'Actions')).active).toBe(false);

  await page.goto('/dashboard/members');
  await page.getByLabel(copy.members.rosterTitle).fill('Paste One, Build\nPaste Two, Brand New Crew\n,nope');
  await page.getByRole('button', { name: copy.members.rosterSubmit }).click();
  await expect(page.getByText(copy.members.rosterResult(2, 1, 0))).toBeVisible();
  await expect(page.locator('[data-group="Brand New Crew"] [data-member-name="Paste Two"]')).toBeVisible();

  await page.goto('/dashboard/members/print');
  await expect(page.getByRole('heading', { name: copy.members.printTitle })).toBeVisible();
  expect(await page.locator('[data-testid="print-card"]').count()).toBeGreaterThan(3);
  await expect(page.locator('[data-testid="print-card"]', { hasText: 'Row A.' })).toHaveCount(0);
});

test('a captain makes an invite link and the lead sets a password and gets in', async ({ page, browser }) => {
  await logIn(page);
  await page.goto('/dashboard/members');
  await page.locator('[data-member-name="Test Lead"]').click();
  await page.locator('[data-member-name="Test Lead"]').getByRole('button', { name: copy.members.invite }).click();
  const link = await page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  const context = await browser.newContext();
  const leadPage = await context.newPage();
  await leadPage.goto(link);
  await expect(leadPage.getByRole('heading', { name: copy.invite.title('Test') })).toBeVisible();
  await leadPage.getByLabel(copy.invite.name).fill('testlead');
  await leadPage.getByLabel(copy.invite.password).fill('abcd');
  await leadPage.getByRole('button', { name: copy.invite.submit }).click();
  await expect(leadPage.getByText(copy.invite.weakPassword)).toBeVisible();
  await leadPage.getByLabel(copy.invite.password).fill('a long enough password');
  await leadPage.getByRole('button', { name: copy.invite.submit }).click();
  await leadPage.waitForURL('**/dashboard');
  await expect(leadPage.getByText(copy.nav.loggedInAs('Test Lead'))).toBeVisible();
  // A lead who is not a captain sees no invite buttons.
  await leadPage.goto('/dashboard/members');
  await expect(leadPage.getByRole('button', { name: copy.members.invite })).toHaveCount(0);
  // The link works once.
  await leadPage.goto(link);
  await expect(leadPage.getByRole('heading', { name: copy.invite.badLinkTitle })).toBeVisible();
  await context.close();
});

test('the dashboard has no sideways scroll at 1440 or 390', async ({ page }) => {
  await logIn(page);
  const wide: string[] = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/dashboard', '/dashboard/tasks', '/dashboard/tasks/new', '/dashboard/finished', '/dashboard/members', '/dashboard/members/print', '/dashboard/attendance', '/dashboard/kiosk']) {
      await page.goto(path);
      const widest = await page.evaluate(() => {
        if (document.documentElement.scrollWidth <= window.innerWidth) return null;
        // Name the element that sticks out furthest, to make the fault easy to find.
        let worst: Element | null = null;
        let right = window.innerWidth;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > right + 0.5) {
            right = r.right;
            worst = el;
          }
        }
        return worst ? `${worst.tagName.toLowerCase()}.${String(worst.className).slice(0, 60)} to ${Math.round(right)}px` : 'unknown';
      });
      if (widest) wide.push(`${path} at ${width}: ${widest}`);
    }
  }
  expect(wide).toEqual([]);
});
