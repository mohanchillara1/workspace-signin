import { describe, expect, it } from 'vitest';
import { shortName } from '@/lib/names';

describe('shortName', () => {
  it('shows the first name and the last initial', () => {
    expect(shortName('Test', 'Member')).toBe('Test M.');
  });
  it('copes with accents, one-word names, spaces and lower case', () => {
    expect(shortName('Zoë', 'Ünal')).toBe('Zoë Ü.');
    expect(shortName('Cher', '')).toBe('Cher');
    expect(shortName('  Test ', " o'neil")).toBe('Test O.');
  });
});
