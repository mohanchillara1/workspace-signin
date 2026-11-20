import { describe, expect, it } from 'vitest';
import { isChallenge, isLoginWall, isOurAnswer } from '@/scripts/live-rules';

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
