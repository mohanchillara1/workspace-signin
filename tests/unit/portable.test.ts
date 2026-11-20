import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Nothing in the code, the tests or the notes may name a folder on one
// person's machine: a test that writes there fails for everyone else. The
// patterns are built from pieces so this file does not match itself.
const slash = '/';
const MACHINE_PATHS: [string, RegExp][] = [
  ['a Windows drive under WSL', new RegExp(['', 'mnt', '[a-z]', ''].join(slash))],
  ['a home folder', new RegExp(['', 'home', '[a-z]'].join(slash))],
  ['a Windows user folder', new RegExp(['[A-Z]:', 'Users'].join('\\\\'))],
  ['a private notes folder', new RegExp(['mohan', 'vault'].join(''))],
  ['a private work folder', new RegExp(['singfrc', 'work'].join('-'))],
];

const FOLDERS = ['app', 'components', 'lib', 'scripts', 'tests', 'drizzle'];
const TEXT = /\.(ts|tsx|mjs|js|json|md|css|sql|example)$/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return TEXT.test(entry.name) ? [path] : [];
  });
}

function topLevelFiles(): string[] {
  return readdirSync('.', { withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT.test(entry.name) && entry.name !== 'package-lock.json' && !entry.name.startsWith('.env.'))
    .map((entry) => entry.name)
    .concat(['.env.example']);
}

describe('the repo runs on any machine', () => {
  it('the check sees a machine path when there is one', () => {
    const sample = ['const out = "', 'mnt', 'c', 'Users', 'someone', 'shots"'].join(slash);
    expect(MACHINE_PATHS.some(([, pattern]) => pattern.test(sample))).toBe(true);
    expect(MACHINE_PATHS.some(([, pattern]) => pattern.test('const out = testInfo.outputPath("shots")'))).toBe(false);
  });

  it("no file names a folder on one person's machine", () => {
    const found: string[] = [];
    for (const file of [...FOLDERS.flatMap(filesUnder), ...topLevelFiles()]) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [what, pattern] of MACHINE_PATHS) {
          if (pattern.test(line)) found.push(`${file}:${index + 1} names ${what}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
