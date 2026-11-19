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
