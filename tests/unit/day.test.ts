import { describe, expect, it } from 'vitest';
import { addDays, chicagoDay } from '@/lib/day';

describe('chicagoDay', () => {
  it('uses the Central date just before and at midnight in winter', () => {
    expect(chicagoDay(new Date('2026-11-19T05:59:00Z'))).toBe('2026-11-18');
    expect(chicagoDay(new Date('2026-11-19T06:00:00Z'))).toBe('2026-11-19');
  });
  it('is right on the clock-change day', () => {
    expect(chicagoDay(new Date('2026-03-08T07:30:00Z'))).toBe('2026-03-08');
  });
  it('uses the Central date just before midnight in summer', () => {
    expect(chicagoDay(new Date('2026-07-01T04:59:00Z'))).toBe('2026-06-30');
  });
});

describe('addDays', () => {
  it('moves across a month end and backwards', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
