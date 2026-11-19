import { describe, expect, it } from 'vitest';
import { hit } from '@/lib/rate-limit';
import { useTestDb } from '../setup/db';

describe('rate limit', () => {
  const getDb = useTestDb();
  const now = new Date('2026-11-18T23:00:10Z');

  it('refuses the hit after the limit and allows again in the next window', async () => {
    const db = getDb();
    for (let i = 0; i < 5; i++) {
      expect((await hit(db, { key: 'a', limit: 5, windowSeconds: 60, now })).allowed).toBe(true);
    }
    expect((await hit(db, { key: 'a', limit: 5, windowSeconds: 60, now })).allowed).toBe(false);
    const later = new Date(now.getTime() + 60_000);
    expect((await hit(db, { key: 'a', limit: 5, windowSeconds: 60, now: later })).allowed).toBe(true);
  });

  it('keeps separate counts for separate keys', async () => {
    const db = getDb();
    expect((await hit(db, { key: 'b', limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await hit(db, { key: 'c', limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await hit(db, { key: 'b', limit: 1, windowSeconds: 60, now })).allowed).toBe(false);
  });

  it('counts hits that arrive together', async () => {
    const db = getDb();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => hit(db, { key: 'd', limit: 5, windowSeconds: 60, now })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
