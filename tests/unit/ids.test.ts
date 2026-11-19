import { describe, expect, it } from 'vitest';
import { newPageKey, newScanCode, newToken, sha256 } from '@/lib/ids';

describe('ids', () => {
  it('makes scan codes of the agreed shape, all different', () => {
    const codes = Array.from({ length: 1000 }, () => newScanCode());
    for (const code of codes) expect(code).toMatch(/^SR1-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(new Set(codes).size).toBe(1000);
  });
  it('makes page keys and tokens that are safe in a link', () => {
    expect(newPageKey()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newPageKey()).not.toBe(newPageKey());
  });
  it('hashes text the same way every time', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
