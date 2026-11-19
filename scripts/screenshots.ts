// Takes the screenshots a person looks at before anything is deployed, and
// checks each screen for sideways scroll and console errors.
//   npm run build && npm run screenshots -- <folder to save into>
// It starts its own throwaway Postgres with made-up people, and its own copy
// of the built app, so it never touches the development database.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { chicagoDay } from '../lib/day';
import { makeDb } from '../lib/db/client';
import { ensureDatabase, startLocalPostgres } from '../lib/db/local';
import { migrateUrl } from '../lib/db/migrate';
import { pairKiosk } from '../lib/kiosk';
import { decide } from '../lib/review';
import { seedDemo } from '../lib/seed';
import { submitWork } from '../lib/submit';
import { createTask, openFor, publishTask } from '../lib/tasks';
import { copy } from '../lib/copy';

const APP_PORT = 4322;
const DB_PORT = 54331;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const outDir = resolve(process.argv[2] ?? 'screens');
const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';

type Check = { shot: string; size: string; sideways: boolean; errors: string[] };
const checks: Check[] = [];

/** A plain grey picture for the fake camera, so the idle screen shows a live view with no code in it. */
function writeBlankVideo(file: string) {
  const W = 1280;
  const H = 720;
  const y = Buffer.alloc(W * H);
  for (let row = 0; row < H; row++) y.fill(70 + Math.round((row / H) * 60), row * W, (row + 1) * W);
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
}

async function shoot(page: Page, name: string, errors: string[], fullPage = true) {
  await page.waitForTimeout(350);
  const info = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > window.innerWidth,
    size: `${window.innerWidth}x${window.innerHeight}`,
  }));
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage });
  checks.push({ shot: name, size: info.size, sideways: info.sideways, errors: errors.splice(0) });
}

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function feed(page: Page, code: string) {
  await page.locator('[data-testid="kiosk"][data-ready="1"]').waitFor();
  await page.evaluate((text) => window.dispatchEvent(new CustomEvent('kiosk:test-scan', { detail: text })), code);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'signin-shots-'));
  const pg = await startLocalPostgres({ dir: join(work, 'data'), port: DB_PORT, persistent: false, fresh: true });
  await ensureDatabase(pg.url('postgres'), 'shots');
  const dbUrl = pg.url('shots');
  await migrateUrl(dbUrl);
  const { db, pool } = makeDb(dbUrl);
  const password = `local-${randomBytes(9).toString('base64url')}`;
  const seed = await seedDemo(db, { captainPassword: password, today: chicagoDay(new Date()) });
  const m = seed.members;

  // Phase 2: one member with work waiting, work sent back and work approved,
  // made with the same functions the screens call.
  const today = chicagoDay(new Date());
  const captain = seed.captain.member.id;
  const sendIn = async (title: string, note: string, link = '', via: 'member_page' | 'kiosk' = 'member_page') => {
    const task = await createTask(db, { title, audience: 'person', memberIds: [m.B.id], steps: ['Check the drawing', 'Do the work', 'Tidy up'] }, captain);
    await publishTask(db, task.id, captain);
    const handout = (await openFor(db, m.B.id, today)).find((h) => h.taskId === task.id)!;
    await submitWork(db, { taskId: task.id, assignmentId: handout.assignmentId, memberId: m.B.id, note, link, via, today });
    return handout.assignmentId!;
  };
  await sendIn('Mount the gearbox plate', 'Plate is on. Two bolts are finger tight until the shaft is in.', 'https://example.org/gearbox-plate');
  await sendIn('Tape the battery leads', '', '', 'kiosk');
  const back = await sendIn('Label the wire runs', 'Labeled the left side.');
  await decide(db, { assignmentId: back, decision: 'sent_back', comment: 'The right side has no labels yet.', actorId: captain });
  const good = await sendIn('Charge the spare batteries', 'All four are on the chargers.');
  await decide(db, { assignmentId: good, decision: 'approved', comment: '', actorId: captain });

  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT), '-H', '127.0.0.1'], {
    stdio: 'ignore',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      SESSION_SECRET: randomBytes(32).toString('base64url'),
      KIOSK_TEST_FEED: '1',
      // "Draft steps" answers from the built-in stand-in. No AI service is called.
      STEP_DRAFTS_STAND_IN: '1',
      ANTHROPIC_API_KEY: '',
      KIOSK_IDLE_SECONDS: '60',
    },
  });
  let failed = false;
  try {
    // If the app could not start (a stale server on the port, say), stop here
    // instead of photographing something else.
    let exited = false;
    app.on('exit', () => {
      exited = true;
    });
    let up = false;
    for (let i = 0; i < 100 && !up && !exited; i++) {
      await new Promise((r) => setTimeout(r, 300));
      up = !exited && (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false));
    }
    if (!up || exited) throw new Error(`The app did not start on port ${APP_PORT}. Is something else using it?`);
    const video = join(work, 'blank.y4m');
    writeBlankVideo(video);
    const browser = await chromium.launch({
      executablePath: chrome,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
    });
    const k = copy.kiosk;

    // The kiosk, portrait then landscape.
    for (const [label, viewport, first, second] of [
      ['portrait-1024x1366', { width: 1024, height: 1366 }, m.A, m.B],
      ['landscape-1366x1024', { width: 1366, height: 1024 }, m.D, m.G],
    ] as const) {
      const context = await browser.newContext({ viewport });
      const { token } = await pairKiosk(db, { name: 'Wall iPad', actorId: seed.captain.member.id });
      await context.addCookies([{ name: 'kiosk', value: token, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}/kiosk`);
      await page.getByText(k.cameraHint).waitFor();
      await page.waitForTimeout(1200);
      await shoot(page, `kiosk-idle-${label}`, errors, false);
      await feed(page, first.scanCode);
      await page.getByRole('heading', { name: k.hello(first.firstName) }).waitFor();
      await shoot(page, `kiosk-after-scan-${label}`, errors, false);
      await page.locator('article[data-testid="task"] h3').first().click();
      await shoot(page, `kiosk-task-steps-${label}`, errors, false);
      await page.getByRole('button', { name: k.backNow, exact: true }).click();
      await feed(page, 'https://example.com/not-a-member-code');
      await page.getByRole('heading', { name: k.unknownTitle }).waitFor();
      await shoot(page, `kiosk-unknown-code-${label}`, errors, false);
      // A second person, so the Today screen has a few people on it.
      await feed(page, second.scanCode);
      await page.getByRole('heading', { name: k.hello(second.firstName) }).waitFor();
      // Member B has work a lead sent back: the wall says so without the lead's words.
      if (second.id === m.B.id) await shoot(page, `kiosk-sent-back-${label}`, errors, false);
      await context.close();
    }
    {
      // Someone with no task of their own, for "here with nothing to do".
      const context = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
      const { token } = await pairKiosk(db, { name: 'Wall iPad', actorId: seed.captain.member.id });
      await context.addCookies([{ name: 'kiosk', value: token, url: BASE, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      await page.goto(`${BASE}/kiosk`);
      await feed(page, m.I.scanCode);
      await page.getByRole('heading', { name: k.hello(m.I.firstName) }).waitFor();
      await context.close();
    }

    // The member page on a phone.
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}/m/${m.A.pageKey}`);
      await shoot(page, 'member-page-390', errors);
      // Phase 2: sent-back work with the lead's comment, the "sent in" list, and the form.
      await page.goto(`${BASE}/m/${m.B.pageKey}`);
      await shoot(page, 'member-page-sent-in-390', errors);
      await page.locator('article[data-testid="task"]', { hasText: 'Read the shop safety sheet' }).getByRole('button', { name: k.done, exact: true }).click();
      await page.getByTestId('send-in-form').waitFor();
      await shoot(page, 'member-page-send-in-form-390', errors);
      await context.close();
    }

    // The lead dashboard, wide and on a phone.
    for (const [label, viewport] of [
      ['1440', { width: 1440, height: 900 }],
      ['390', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = watch(page);
      await page.goto(`${BASE}/login`);
      await shoot(page, `login-${label}`, errors);
      await page.getByLabel(copy.login.name).fill(seed.captain.loginName);
      await page.getByLabel(copy.login.password).fill(password);
      await page.getByRole('button', { name: copy.login.submit }).click();
      await page.waitForURL('**/dashboard');
      for (const [name, path] of [
        ['today', '/dashboard'],
        ['tasks', '/dashboard/tasks'],
        ['task-new', '/dashboard/tasks/new'],
        ['review', '/dashboard/review'],
        ['finished', '/dashboard/finished'],
        ['members', '/dashboard/members'],
        ['attendance', '/dashboard/attendance'],
        ['kiosk-setup', '/dashboard/kiosk'],
      ] as const) {
        await page.goto(`${BASE}${path}`);
        await shoot(page, `dashboard-${name}-${label}`, errors);
      }
      // Phase 2: steps drafted by the stand-in, sitting in the box for the lead to edit.
      await page.goto(`${BASE}/dashboard/tasks/new`);
      await page.getByLabel(copy.tasks.fieldTitle).fill('Sort the pneumatics drawer');
      await page.getByRole('button', { name: copy.drafts.button }).click();
      await page.getByText(copy.drafts.filled).waitFor();
      await shoot(page, `dashboard-task-drafted-${label}`, errors);
      await context.close();
    }
    await browser.close();

    for (const check of checks) {
      const ok = !check.sideways && check.errors.length === 0;
      if (!ok) failed = true;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${check.shot} (${check.size})${check.sideways ? ' | sideways scroll' : ''}${check.errors.length ? ` | ${check.errors.join(' ; ')}` : ''}`);
    }
    console.log(`${checks.length} screenshots in ${outDir}`);
  } finally {
    app.kill('SIGTERM');
    await pool.end();
    await pg.stop().catch(() => {});
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
