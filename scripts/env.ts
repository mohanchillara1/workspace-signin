// Scripts read the same .env.local the app does.
import { existsSync } from 'node:fs';

export function loadEnv(): void {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}

export function databaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  return url;
}

export function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

/** Which database a script is about to touch, said without giving its address away. */
export function describeDatabase(url: string): string {
  if (isLocal(url)) return 'on this machine';
  const labels = new URL(url).hostname.split('.');
  return `hosted, at *.${labels.slice(-2).join('.')}`;
}

/**
 * Why a database must not be given made-up rows, or null when it may. A
 * database on this machine always may. A hosted one may only when it belongs
 * to a test copy, so made-up rows can never land next to real ones.
 */
export function seedRefusal(url: string, testCopy: boolean): string | null {
  if (isLocal(url) || testCopy) return null;
  return 'Refusing to seed: DATABASE_URL does not point at this machine, and TEST_COPY is not "1".';
}
