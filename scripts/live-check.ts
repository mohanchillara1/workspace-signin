// Checks a hosted copy of the app from the outside.
//
// Signed out, with plain requests (needs nothing but the address):
//   npx tsx scripts/live-check.ts https://the-site.example
//   ... --no-db      while the copy has no database yet
//
// The whole loop in headless Chrome with a fake camera (needs the same
// DATABASE_URL the site uses, and TEST_COPY=1):
//   vercel env run -e production -p <project> -- npx tsx scripts/live-check.ts https://the-site.example --loop [--shots <folder>]
//
// The loop signs a made-up member in and finishes a task, so it refuses to
// run against anything that is not a test copy. It prints no address, no
// password and no link.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { and, eq, like } from 'drizzle-orm';
import { createInvite } from '../lib/auth/leads';
import { copy } from '../lib/copy';
import { chicagoDay } from '../lib/day';
import { makeDb } from '../lib/db/client';
import { assignments, attendance, kiosks, members, rateHits, submissions, tasks } from '../lib/db/schema';
import { isTestCopy } from '../lib/test-copy';
import { writeQrVideo } from '../tests/e2e/fake-camera';
import { databaseUrl, describeDatabase, isLocal } from './env';
import { isChallenge, isLoginWall, isOurAnswer, plan, verdict } from './live-rules';

const args = process.argv.slice(2);
const base = new URL(args.find((a) => !a.startsWith('--')) ?? '').origin;
const flag = (name: string) => args.includes(`--${name}`);
const valueOf = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';

let ran = 0;
let failed = 0;
function check(ok: boolean, what: string, detail = ''): boolean {
  ran++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` | ${detail}` : ''}`);
  return ok;
}
const skip = (what: string, why: string) => console.log(`skip ${what} | ${why}`);

class Challenged extends Error {}

// Requests are spaced out. A burst of them at private-looking paths reads as
// a scanner to the host, which then challenges this address on every path.
const PAUSE_MS = 400;
const pause = () => new Promise((done) => setTimeout(done, PAUSE_MS));

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  await pause();
  const response = await fetch(base + path, { redirect: 'manual', cache: 'no-store', ...init });
  // The checkpoint answers for every path, so no answer after it means anything.
  if (isChallenge(response.headers)) throw new Challenged(path);
  return response;
}

/** What a visitor with no login and no paired device gets. */
async function signedOut(hasDb: boolean, privateFiles: boolean) {
  console.log(`\nSigned out, plain requests to ${base}`);

  // Every kind of page: reachable without a Vercel login, and never indexed.
  const pages = ['/', '/login', '/kiosk', '/dashboard', '/dashboard/members', '/m/not-a-real-page-key', '/invite/not-a-real-invite-token-0000', '/api/health', '/robots.txt', '/icon.svg', '/wordmark.png', '/no-such-page'];
  for (const path of pages) {
    const response = await get(path);
    const robots = response.headers.get('x-robots-tag') ?? '';
    check(!isLoginWall(response.status, response.headers), `${path} is not behind a Vercel login`, `status ${response.status}`);
    check(isOurAnswer(response.status, response.headers), `${path} is answered by the app itself, marked noindex`, `status ${response.status}, x-robots-tag: ${robots || 'missing'}`);
  }
  const robotsTxt = await (await get('/robots.txt')).text();
  check(/Disallow:\s*\/\s*$/m.test(robotsTxt), 'robots.txt tells every crawler to stay out', robotsTxt.replace(/\s+/g, ' ').trim());

  const home = await get('/');
  check(home.status >= 300 && home.status < 400 && /\/dashboard$/.test(home.headers.get('location') ?? ''), 'the front door sends you to the dashboard', `status ${home.status}`);
  const headers = (await get('/login')).headers;
  check(/max-age=\d+/.test(headers.get('strict-transport-security') ?? ''), 'pages are sent with strict transport', headers.get('strict-transport-security') ?? 'missing');
  check(/default-src 'self'/.test(headers.get('content-security-policy') ?? ''), 'pages are sent with the content policy');
  check(!headers.get('x-powered-by'), 'no framework banner');

  if (privateFiles) {
  // Controls: a file that should be served is served.
  check((await get('/wordmark.png')).status === 200, 'control: the wordmark picture is served (so a 404 below means something)');
  check((await get('/zxing_reader.wasm')).status === 200, 'control: the QR decoder file is served');

  // The files that would matter most if they could be fetched. Kept short on
  // purpose: a long sweep of private-looking paths gets this address
  // challenged. Whether a local folder was uploaded at all is answered by the
  // host's own file list (vercel api "/v6/deployments/<id>/files"), which
  // costs the site no requests.
  const mustBeMissing = [
    '/.env.local', '/.env', '/.data/review-4320.json', '/.e2e/state.json',
    '/phase0-test/site/.env.local', '/.git/config', '/package.json', '/lib/seed.ts',
  ];
  for (const path of mustBeMissing) {
    const response = await get(path);
    check(response.status === 404, `${path} cannot be fetched`, `status ${response.status}`);
  }
  } else {
    skip('whether private files can be fetched', 'not asked for (--no-private). Nothing here says they cannot be');
  }

  if (!hasDb) {
    skip('the kiosk page, the dashboard redirect, the scan route and the health check', 'they ask the database, and this copy has none yet');
    return;
  }
  const health = await get('/api/health');
  check(health.status === 200 && (await health.json()).ok === true, 'the health check reaches the database', `status ${health.status}`);

  const kiosk = await get('/kiosk');
  const kioskHtml = await kiosk.text();
  check(kiosk.status === 200 && kioskHtml.includes(copy.kiosk.notPairedTitle) && !kioskHtml.includes('data-testid="kiosk"'), 'the kiosk page refuses a browser that is not paired', `status ${kiosk.status}`);
  const scan = await get('/api/kiosk/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'SR1-00000000000000000000000000' }) });
  check(scan.status === 401, 'the scan route refuses a browser that is not paired', `status ${scan.status}`);

  for (const path of ['/dashboard', '/dashboard/members', '/dashboard/tasks', '/dashboard/review', '/dashboard/attendance', '/dashboard/kiosk', '/dashboard/attendance/export?from=2026-01-01&to=2026-12-31']) {
    const response = await get(path);
    const body = await response.text();
    check(response.status >= 300 && response.status < 400 && /\/login$/.test(response.headers.get('location') ?? '') && !/Test Member/.test(body), `${path} sends you to the login page`, `status ${response.status}`);
  }
  const login = await (await get('/login')).text();
  check(login.includes(copy.login.title), 'the login page opens');
  const badPage = await get('/m/not-a-real-page-key');
  check(badPage.status === 404, 'a wrong member link opens nothing', `status ${badPage.status}`);
}

const watch = (page: Page, errors: string[]) => {
  page.on('console', (message) => message.type() === 'error' && errors.push(`${new URL(page.url()).pathname}: ${message.text()}`));
  page.on('pageerror', (error) => errors.push(`${new URL(page.url()).pathname}: ${String(error)}`));
};

async function logIn(page: Page, loginName: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(copy.login.name).fill(loginName);
  await page.getByLabel(copy.login.password).fill(password);
  await page.getByRole('button', { name: copy.login.submit }).click();
  await page.waitForURL('**/dashboard');
}

const cookieNamed = async (context: BrowserContext, name: string) => (await context.cookies(base)).find((c) => c.name === name);

/** The loop a person would walk through, on the hosted copy, with a fake camera. */
async function loop(shots: string | undefined) {
  console.log('\nThe loop, in headless Chrome with a fake camera');
  const url = databaseUrl();
  if (isLocal(url)) throw new Error('The loop needs the hosted database the site uses. DATABASE_URL points at this machine.');
  if (!isTestCopy()) throw new Error('Refusing to run the loop: TEST_COPY is not "1", so this may not be a test copy.');
  console.log(`database: ${describeDatabase(url)}`);
  const { db, pool } = makeDb(url);
  const errors: string[] = [];
  const browserDir = mkdtempSync(join(tmpdir(), 'signin-live-'));
  const video = join(browserDir, 'camera.y4m');
  const today = chicagoDay(new Date());
  const title = `Live check job ${randomBytes(3).toString('hex')}`;
  const kioskName = `Live check kiosk ${randomBytes(2).toString('hex')}`;
  const password = randomBytes(18).toString('base64url');
  const loginName = 'testcaptain';

  try {
    const [captain] = await db.select().from(members).where(and(eq(members.role, 'captain'), eq(members.firstName, 'Test'), eq(members.lastName, 'Captain')));
    const [member] = await db.select().from(members).where(and(eq(members.firstName, 'Test'), eq(members.lastName, 'Member A')));
    if (!check(!!captain && !!member, 'the seeded captain and Test Member A are in the hosted database')) return;
    const token = await createInvite(db, { memberId: captain.id, actorId: null, now: new Date(), bootstrap: true });
    writeQrVideo(video, member.scanCode);

    const browser = await chromium.launch({
      executablePath: chrome,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
    });
    try {
      const desk = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
      desk.setDefaultTimeout(30_000);
      const lead = await desk.newPage();
      watch(lead, errors);

      // A captain opens an invite link and sets a password. The password is hashed on the host.
      await lead.goto(`/invite/${token}`);
      await lead.getByLabel(copy.invite.name).fill(loginName);
      await lead.getByLabel(copy.invite.password).fill(password);
      await lead.getByRole('button', { name: copy.invite.submit }).click();
      await lead.waitForURL('**/dashboard');
      check(true, 'a captain invite link is accepted and lands on the dashboard');
      const session = await cookieNamed(desk, 'lead');
      check(!!session && session.secure && session.httpOnly && session.sameSite === 'Lax', 'the login cookie is Secure, HttpOnly and SameSite=Lax over https', session ? `secure ${session.secure}, httpOnly ${session.httpOnly}, sameSite ${session.sameSite}` : 'no cookie');
      await expectVisible(lead.locator('header').getByTestId('test-copy'), 'the dashboard header shows the test-copy tag');
      if (shots) await lead.screenshot({ path: join(shots, 'test-copy-live-dashboard-1440.png'), fullPage: true });

      // Log out and in again: the stored hash is checked on the host too.
      await lead.getByRole('button', { name: copy.nav.logout }).click();
      await lead.waitForURL('**/login');
      await lead.goto('/dashboard');
      check(new URL(lead.url()).pathname === '/login', 'after logging out the dashboard asks for a login again');
      await logIn(lead, loginName, password);
      check(true, 'logging in with the new password works (the password check runs on the host)');

      // A task for Test Member A that needs a lead's check.
      await lead.goto('/dashboard/tasks/new');
      await lead.getByLabel(copy.tasks.fieldTitle).fill(title);
      await lead.getByLabel(copy.tasks.audiencePerson).check();
      await lead.getByLabel('Test Member A', { exact: true }).check();
      await lead.getByLabel(copy.tasks.fieldNeedsCheck).check();
      await lead.getByRole('button', { name: copy.tasks.publish }).click();
      await lead.getByText(copy.tasks.published).waitFor();
      check(true, 'a lead writes and publishes a task for one member');

      // A second browser is made the kiosk through the screens.
      const wall = await browser.newContext({ baseURL: base, viewport: { width: 1024, height: 1366 } });
      wall.setDefaultTimeout(30_000);
      const kiosk = await wall.newPage();
      watch(kiosk, errors);
      await logIn(kiosk, loginName, password);
      await kiosk.goto('/dashboard/kiosk');
      await kiosk.getByLabel(copy.kioskAdmin.name).fill(kioskName);
      await kiosk.getByRole('button', { name: copy.kioskAdmin.pair }).click();
      await kiosk.waitForURL('**/kiosk');
      const paired = await cookieNamed(wall, 'kiosk');
      const days = paired ? (paired.expires - Date.now() / 1000) / 86_400 : 0;
      check(!!paired && paired.secure && paired.httpOnly && days > 390, 'pairing sets a kiosk cookie that is Secure, HttpOnly and lasts about 400 days', paired ? `secure ${paired.secure}, httpOnly ${paired.httpOnly}, ${Math.round(days)} days` : 'no cookie');
      check(!(await cookieNamed(wall, 'lead'))?.value, 'pairing logs the lead out on that device');

      // The camera and the decoder read Test Member A's code. Nothing feeds it in.
      await kiosk.getByRole('heading', { name: copy.kiosk.hello('Test') }).waitFor({ timeout: 40_000 });
      check((await kiosk.getByTestId('kiosk-name').textContent()) === 'Test M.', 'the kiosk reads a QR through the camera path and greets the member by first name and last initial');
      await expectVisible(kiosk.locator('footer').getByTestId('test-copy'), 'the kiosk footer shows the test-copy tag');
      if (shots) await kiosk.screenshot({ path: join(shots, 'test-copy-live-kiosk-1024x1366.png') });
      const rows = await db.select().from(attendance).where(and(eq(attendance.memberId, member.id), eq(attendance.day, today)));
      check(rows.length === 1 && rows[0].source === 'kiosk', 'the hosted database has exactly one attendance row for that member today, from the kiosk', `${rows.length} row(s)`);

      // Done on the kiosk: two taps, and it waits for a lead.
      const card = kiosk.locator('article[data-testid="task"]', { hasText: title });
      await card.getByRole('button', { name: copy.kiosk.done, exact: true }).click();
      await card.getByRole('button', { name: copy.kiosk.confirmDone }).click();
      await kiosk.getByText(copy.submit.kioskWaiting).waitFor();
      const [task] = await db.select().from(tasks).where(eq(tasks.title, title));
      const stateNow = async () => (await db.select().from(assignments).where(eq(assignments.taskId, task.id)))[0]?.state;
      check((await stateNow()) === 'submitted', 'Done on the kiosk sends the task to the leads to check', `state ${await stateNow()}`);

      // The lead approves it.
      await lead.goto('/dashboard/review');
      const waiting = lead.locator('[data-testid="review-card"]', { hasText: title });
      await waiting.getByRole('button', { name: `${copy.review.approve}: ${title}`, exact: true }).click();
      await lead.locator('[data-testid="review-card"]', { hasText: title }).waitFor({ state: 'detached' });
      await lead.goto('/dashboard/finished');
      await expectVisible(lead.getByTestId('finished-row').filter({ hasText: title }).getByTestId('approved-chip'), 'the lead approves it and Finished shows it as approved');
      const [handout] = await db.select().from(assignments).where(eq(assignments.taskId, task.id));
      const [sent] = await db.select().from(submissions).where(eq(submissions.assignmentId, handout.id));
      check(handout.state === 'approved' && sent.via === 'kiosk' && sent.reviewedById === captain.id, 'the hosted database agrees: approved, sent from the kiosk, checked by the captain', `state ${handout.state}`);

      // The member's own page, at phone size.
      const phone = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } });
      phone.setDefaultTimeout(30_000);
      const mine = await phone.newPage();
      watch(mine, errors);
      const opened = await mine.goto(`/m/${member.pageKey}`);
      await expectVisible(mine.getByRole('heading', { name: copy.member.greeting('Test') }), "a member's page opens on a phone-size screen with no login");
      check(/noindex/.test(opened?.headers()['x-robots-tag'] ?? ''), "the member's page is marked noindex");
      check(await mine.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the member's page has no sideways scroll at 390");
      if (shots) await mine.screenshot({ path: join(shots, 'test-copy-live-member-390.png'), fullPage: true });

      // The rate limits count the visitor's real address, not one a visitor makes up.
      const forged = '203.0.113.9';
      await get(`/m/${member.pageKey}`, { headers: { 'x-forwarded-for': forged, 'x-real-ip': forged, 'x-vercel-forwarded-for': forged } });
      const keys = (await db.select({ key: rateHits.key }).from(rateHits).where(like(rateHits.key, 'member-page:%'))).map((row) => row.key.slice('member-page:'.length));
      const real = keys.filter((address) => address !== forged);
      check(!keys.includes(forged), 'a made-up forwarding header does not change which address a rate limit counts');
      check(real.length > 0 && real.every((address) => isIP(address) !== 0 && !/^(10\.|127\.|192\.168\.|169\.254\.|::1$|fc|fd)/.test(address)), 'the address the rate limit counts is a public one, as the host reports it', `${keys.length} address(es) counted, IPv${real.map((a) => isIP(a)).join('/')}`);

      // Leave nothing paired behind.
      await lead.goto('/dashboard/kiosk');
      await lead.getByRole('button', { name: copy.kioskAdmin.unpair(kioskName) }).click();
      await lead.getByText(copy.kioskAdmin.unpaired).first().waitFor();
      await kiosk.goto('/kiosk');
      await expectVisible(kiosk.getByRole('heading', { name: copy.kiosk.notPairedTitle }), 'after it is turned off, that browser is no longer the kiosk');
      const refused = await wall.request.post('/api/kiosk/scan', { data: { code: member.scanCode } });
      check(refused.status() === 401, 'and its scans are refused', `status ${refused.status()}`);
      const [device] = await db.select().from(kiosks).where(eq(kiosks.name, kioskName));
      check(!!device?.revokedAt, 'the hosted database shows the test kiosk as turned off');
      await lead.getByRole('button', { name: copy.nav.logout }).click();
      await lead.waitForURL('**/login');

      check(errors.length === 0, 'no console errors on any live page', errors.join(' ; '));
    } finally {
      await browser.close();
    }
  } finally {
    await pool.end();
  }
}

async function expectVisible(locator: ReturnType<Page['locator']>, what: string) {
  try {
    await locator.waitFor({ state: 'visible' });
    check(true, what);
  } catch {
    check(false, what);
  }
}

async function main() {
  const doing = plan(args);
  if (doing.pages) await signedOut(!flag('no-db'), doing.privateFiles);
  else console.log('\nNo signed-out request was sent (--loop-only). Nothing here says anything about signed-out visitors.');
  if (doing.loop) {
    const shots = valueOf('shots');
    if (shots) mkdirSync(resolve(shots), { recursive: true });
    await loop(shots ? resolve(shots) : undefined);
  }
  const end = verdict(ran, failed);
  console.log(`\n${end.text}`);
  process.exit(end.ok ? 0 : 1);
}

main().catch((error) => {
  if (error instanceof Challenged) {
    console.error(`\nSTOPPED at ${error.message}: the host is challenging this address (its security checkpoint answered, not the app).`);
    console.error('Nothing after this point was checked, and no line above it should be read as a result for a later path. Wait, then run again. Do not try to get past the checkpoint.');
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
