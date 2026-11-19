import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftsAvailable, parseSteps } from '@/lib/step-drafts';

describe('step drafts: check fixes', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps real words that look a little like markup or numbering', () => {
    expect(parseSteps('Keep the voltage < 12V and check wires')).toEqual(['Keep the voltage < 12V and check wires']);
    expect(parseSteps('1. 3.5mm drill bit goes in the box')).toEqual(['3.5mm drill bit goes in the box']);
    expect(parseSteps('2:30 pm meeting, bring parts')).toEqual(['2:30 pm meeting, bring parts']);
    expect(parseSteps('- 2 bolts go in the left bracket')).toEqual(['2 bolts go in the left bracket']);
  });

  it('still strips list markers and real tags', () => {
    expect(parseSteps('1. First\n2) Second\n- Third\n* Fourth\nStep 5: Fifth')).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth']);
    expect(parseSteps('<b>Bold</b> step <img src=x onerror=alert(1)>')).toEqual(['Bold step']);
  });

  it('never uses the stand-in on the real host, whatever the environment is called', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('STEP_DRAFTS_STAND_IN', '1');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('VERCEL', '');
    expect(draftsAvailable()).toBe(true);
    vi.stubEnv('VERCEL', '1');
    expect(draftsAvailable()).toBe(false);
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(draftsAvailable()).toBe(false);
  });
});
