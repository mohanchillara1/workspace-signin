import { describe, expect, it } from 'vitest';
import { addDays, chicagoDay, isDay } from '@/lib/day';

describe('chicagoDay', () => {
  it('uses the Central date just before and at midnight in winter', () => {
    expect(chicagoDay(new Date('2026-11-19T05:59:00Z'))).toBe('2026-11-18');
    expect(chicagoDay(new Date('2026-11-19T06:00:00Z'))).toBe('2026-11-19');
  });
  it('follows the clock change, where a fixed offset would be a day off', () => {
    // After clocks go forward (Mar 8, 2026) Central is UTC-5: 05:30Z is 12:30 AM on the 9th.
    // A fixed winter offset would still say the 8th.
    expect(chicagoDay(new Date('2026-03-09T05:30:00Z'))).toBe('2026-03-09');
    // After clocks go back (Nov 1, 2026) Central is UTC-6: 05:30Z is 11:30 PM on the 1st.
    // A fixed summer offset would already say the 2nd.
    expect(chicagoDay(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-01');
  });
  it('knows a real date from a made-up one', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-31')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('20260228')).toBe(false);
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
