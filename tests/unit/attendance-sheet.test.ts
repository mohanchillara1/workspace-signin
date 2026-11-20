import { describe, expect, it } from 'vitest';
import { parseSheet, SheetError } from '@/lib/attendance-sheet';

const FILE = ['name,2026-09-01,2026-09-03,2026-09-08', 'Sheet Person A,TRUE,FALSE,TRUE', 'Sheet Person B,FALSE,FALSE,FALSE', ''].join('\r\n');

describe('reading an attendance sheet saved as CSV', () => {
  it('reads the days from the first row and a person from each row after it', () => {
    const sheet = parseSheet(FILE);
    expect(sheet.days).toEqual(['2026-09-01', '2026-09-03', '2026-09-08']);
    expect(sheet.people).toEqual([
      { line: 2, firstName: 'Sheet', lastName: 'Person A', days: ['2026-09-01', '2026-09-08'] },
      { line: 3, firstName: 'Sheet', lastName: 'Person B', days: [] },
    ]);
  });

  it('takes the first word as the first name and the rest as the last name', () => {
    const sheet = parseSheet('name,2026-09-01\n  Sheet   Van  Person ,TRUE\nSolo,TRUE\n');
    expect(sheet.people.map((p) => [p.firstName, p.lastName])).toEqual([['Sheet', 'Van Person'], ['Solo', '']]);
  });

  it('reads the marks a spreadsheet writes, in any letter case, and a quoted name', () => {
    const sheet = parseSheet('﻿Name,2026-09-01,2026-09-02,2026-09-03,2026-09-04\n"Sheet Person A",true,x,1,Yes\nSheet Person B,false,,0,no\n');
    expect(sheet.people[0].days).toHaveLength(4);
    expect(sheet.people[1].days).toHaveLength(0);
  });

  it('refuses a file it cannot be sure about, and says where without repeating what the file holds', () => {
    const bad: [string, RegExp][] = [
      ['', /empty/],
      ['person,2026-09-01\nSheet Person A,TRUE\n', /first row/],
      ['name\nSheet Person A\n', /no days/],
      ['name,2026-02-31\nSheet Person A,TRUE\n', /column 2/],
      ['name,09/01/2026\nSheet Person A,TRUE\n', /column 2/],
      ['name,2026-09-01,2026-09-01\nSheet Person A,TRUE,TRUE\n', /columns 2 and 3/],
      ['name,2026-09-01\nSheet Person A,TRUE,TRUE\n', /Line 2/],
      ['name,2026-09-01\nSheet Person A,maybe\n', /Line 2, column 2/],
      ['name,2026-09-01\n,TRUE\n', /Line 2/],
      ['name,2026-09-01\nSheet Person A,TRUE\nsheet  person a,FALSE\n', /Lines 2 and 3/],
      [`name,2026-09-01\n${'A'.repeat(61)} Person,TRUE\n`, /Line 2/],
    ];
    for (const [text, where] of bad) {
      let message = '';
      try {
        parseSheet(text);
      } catch (error) {
        expect(error).toBeInstanceOf(SheetError);
        message = (error as Error).message;
      }
      expect(message, JSON.stringify(text.slice(0, 40))).toMatch(where);
      expect(message).not.toMatch(/Sheet Person|maybe|AAAA/i);
    }
  });
});
