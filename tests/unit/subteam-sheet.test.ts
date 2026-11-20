import { describe, expect, it } from 'vitest';
import { SheetError } from '@/lib/attendance-sheet';
import { parseSubteamSheet } from '@/lib/subteam-sheet';

describe('reading who is in which subteams from a file', () => {
  it('reads a person from each line, with any number of subteams after the name', () => {
    const sheet = parseSubteamSheet(['name,subteams', 'Sheet Person A,Assembly; CAD', '"Sheet Person B", Media ', 'Sheet Person C', 'Sheet Person D,', ''].join('\r\n'));
    expect(sheet.people).toEqual([
      { line: 2, name: 'Sheet Person A', subteams: ['Assembly', 'CAD'] },
      { line: 3, name: 'Sheet Person B', subteams: ['Media'] },
      { line: 4, name: 'Sheet Person C', subteams: [] },
      { line: 5, name: 'Sheet Person D', subteams: [] },
    ]);
  });

  it('works with no header row, and takes a subteam written twice once', () => {
    const sheet = parseSubteamSheet('﻿Sheet  Person A,"Mech + Electrical; cad ;CAD;"\n\nSheet Person B,Scouting/Strategy\n');
    expect(sheet.people).toEqual([
      { line: 1, name: 'Sheet Person A', subteams: ['Mech + Electrical', 'CAD'] },
      { line: 3, name: 'Sheet Person B', subteams: ['Scouting/Strategy'] },
    ]);
  });

  it('refuses a file it cannot be sure about, and says where without repeating what the file holds', () => {
    const bad: [string, RegExp][] = [
      ['', /nobody/],
      ['name,subteams\n', /nobody/],
      ['Sheet Person A,Assembly,CAD\n', /Line 1 has more than two cells/],
      ['name\n,Assembly\n', /Line 2 has no name/],
      ['Sheet Person A,Assembly\nsheet  person a,CAD\n', /Lines 1 and 2/],
    ];
    for (const [text, problem] of bad) {
      let message = '';
      try {
        parseSubteamSheet(text);
      } catch (error) {
        expect(error).toBeInstanceOf(SheetError);
        message = (error as Error).message;
      }
      expect(message).toMatch(problem);
      expect(message).not.toMatch(/Sheet|Person|Assembly|CAD/);
    }
  });
});
