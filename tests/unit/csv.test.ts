import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('toCsv', () => {
  it('quotes commas and quotes', () => {
    expect(toCsv(['name', 'note'], [[`O'Neil, "Jr"`, 'ok']])).toBe(`name,note\r\n"O'Neil, ""Jr""",ok\r\n`);
  });
  it('stops a cell from being read as a spreadsheet formula', () => {
    const csv = toCsv(['a'], [['=1+1'], ['+1'], ['-1'], ['@x'], ['plain']]);
    expect(csv).toBe(`a\r\n'=1+1\r\n'+1\r\n'-1\r\n'@x\r\nplain\r\n`);
  });
  it('keeps a line break inside one cell', () => {
    expect(toCsv(['a'], [['one\ntwo']])).toBe('a\r\n"one\ntwo"\r\n');
  });
});
