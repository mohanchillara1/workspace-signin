import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCopyMd } from '@/lib/copy-md';

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/** Words a person would read that sit in a screen's own file. */
function straysIn(source: string): string[] {
  const found: string[] = [];
  // Words sitting between two tags.
  for (const match of source.matchAll(/>([^<>{}=;()]*[A-Za-z]{2,}[^<>{}=;()]*)</g)) found.push(match[1].trim());
  // Words in an attribute a person reads or hears.
  for (const match of source.matchAll(/\b(?:placeholder|aria-label|title|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
    found.push(match[1]);
  }
  return found;
}

describe('the words on the screens', () => {
  it('the stray-word check sees a stray when there is one', () => {
    expect(straysIn('<p className="x">Hello there</p>')).toEqual(['Hello there']);
    expect(straysIn('<input placeholder="Type here" />')).toEqual(['Type here']);
    expect(straysIn('<p className="x">{copy.app.title}</p>')).toEqual([]);
  });

  it('COPY.md matches lib/copy.ts', () => {
    expect(existsSync('COPY.md')).toBe(true);
    expect(readFileSync('COPY.md', 'utf8')).toBe(buildCopyMd());
  });

  it('no screen has its own words outside lib/copy.ts', () => {
    const strays: string[] = [];
    for (const file of [...tsxFiles('app'), ...tsxFiles('components')]) {
      for (const text of straysIn(readFileSync(file, 'utf8'))) strays.push(`${file}: ${text}`);
    }
    expect(strays).toEqual([]);
  });
});
