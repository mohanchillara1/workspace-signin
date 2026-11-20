import { describe, expect, it } from 'vitest';
import { addressSummary, isChallenge, isLoginWall, isOurAnswer, plan, verdict } from '@/scripts/live-rules';

const h = (init: Record<string, string>) => new Headers(init);
const ours = { 'x-robots-tag': 'noindex, nofollow' };

describe('reading what a hosted copy answers', () => {
  it("knows the host's security checkpoint when it sees one", () => {
    expect(isChallenge(h({ 'x-vercel-mitigated': 'challenge' }))).toBe(true);
    expect(isChallenge(h({ 'x-vercel-mitigated': 'deny' }))).toBe(true);
    expect(isChallenge(h(ours))).toBe(false);
  });

  it("knows the host's own login wall", () => {
    expect(isLoginWall(401, h({}))).toBe(true);
    expect(isLoginWall(307, h({ location: 'https://vercel.com/login?next=x' }))).toBe(true);
    expect(isLoginWall(200, h({ 'set-cookie': '_vercel_sso_nonce=abc; Path=/' }))).toBe(true);
    expect(isLoginWall(307, h({ location: '/login' }))).toBe(false);
  });

  it('counts an answer as the app only when the app itself sent it', () => {
    expect(isOurAnswer(200, h(ours))).toBe(true);
    expect(isOurAnswer(500, h(ours))).toBe(true);
    // The checkpoint's 403 is not the app answering, whatever else is true of it.
    expect(isOurAnswer(403, h({ 'x-vercel-mitigated': 'challenge' }))).toBe(false);
    expect(isOurAnswer(403, h({ ...ours, 'x-vercel-mitigated': 'challenge' }))).toBe(false);
    expect(isOurAnswer(401, h(ours))).toBe(false);
    // An answer with none of the app's own headers proves nothing.
    expect(isOurAnswer(200, h({}))).toBe(false);
  });
});

describe('which parts of the live check run', () => {
  it('by default: the signed-out pages and the few private files, no loop', () => {
    expect(plan([])).toEqual({ pages: true, privateFiles: true, loop: false });
  });
  it('--loop adds the loop', () => {
    expect(plan(['--loop'])).toEqual({ pages: true, privateFiles: true, loop: true });
  });
  it('--no-private asks for no private-looking address at all', () => {
    // For a copy built from the repository: nothing local was uploaded, so there is nothing to probe for,
    // and a run of such requests is what makes a host treat the caller as a scanner.
    expect(plan(['--no-private'])).toEqual({ pages: true, privateFiles: false, loop: false });
    expect(plan(['--loop', '--no-private'])).toEqual({ pages: true, privateFiles: false, loop: true });
  });
  it('--loop-only runs the loop and sends no signed-out request first', () => {
    expect(plan(['--loop-only'])).toEqual({ pages: false, privateFiles: false, loop: true });
    expect(plan(['--loop-only', '--shots', 'somewhere'])).toEqual({ pages: false, privateFiles: false, loop: true });
  });
});

describe('what the live check says at the end', () => {
  it('passes only when checks ran and none failed', () => {
    expect(verdict(12, 0)).toEqual({ ok: true, text: '12 checks ran. All passed' });
    expect(verdict(12, 2)).toEqual({ ok: false, text: '2 of 12 checks FAILED' });
  });
  it('a run in which nothing was checked is not a pass', () => {
    expect(verdict(0, 0)).toEqual({ ok: false, text: 'No check ran, so nothing was shown' });
  });
});

describe('how the live check words the addresses a rate limit counted', () => {
  it('counts addresses, not rows: the table holds one row per time window', () => {
    expect(addressSummary(['198.51.100.7', '198.51.100.7'])).toBe('1 address in 2 counts');
    expect(addressSummary(['198.51.100.7', '198.51.100.8', '198.51.100.7'])).toBe('2 addresses in 3 counts');
    expect(addressSummary(['198.51.100.7'])).toBe('1 address in 1 count');
  });
});
