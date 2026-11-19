import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { makeDb } from '@/lib/db/client';
import { pairKiosk } from '@/lib/kiosk';
import { copy } from '@/lib/copy';

export type State = { dbUrl: string; baseUrl: string; captain: { loginName: string; password: string } };

export function state(): State {
  return JSON.parse(readFileSync('.e2e/state.json', 'utf8'));
}

let handle: ReturnType<typeof makeDb> | undefined;

/** The browser tests' own handle on the same database the app is using. */
export function db() {
  handle ??= makeDb(state().dbUrl);
  return handle.db;
}

export async function closeDb() {
  await handle?.pool.end();
  handle = undefined;
}

export async function captainId(): Promise<string> {
  const { members } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const [row] = await db().select().from(members).where(eq(members.role, 'captain'));
  return row.id;
}

/** Makes this browser a paired kiosk without going through the screens. */
export async function pairByCookie(context: BrowserContext, name = 'Test kiosk'): Promise<string> {
  const { id, token } = await pairKiosk(db(), { name, actorId: await captainId() });
  await context.addCookies([{ name: 'kiosk', value: token, url: state().baseUrl, httpOnly: true, sameSite: 'Lax' }]);
  return id;
}

/** What the camera would do: hand the kiosk a code it has just read. */
export async function feed(page: Page, code: string): Promise<void> {
  await page.evaluate((text) => window.dispatchEvent(new CustomEvent('kiosk:test-scan', { detail: text })), code);
}

export async function logIn(page: Page): Promise<void> {
  const { captain } = state();
  await page.goto('/login');
  await page.getByLabel(copy.login.name).fill(captain.loginName);
  await page.getByLabel(copy.login.password).fill(captain.password);
  await page.getByRole('button', { name: copy.login.submit }).click();
  await page.waitForURL('**/dashboard');
}

/** Fails the test on any console error or page error. Call at the start. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}
