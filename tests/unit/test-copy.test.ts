import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/lib/copy';
import { isTestCopy } from '@/lib/test-copy';
import { describeDatabase, seedRefusal } from '@/scripts/env';

const before = process.env.TEST_COPY;
afterEach(() => {
  if (before === undefined) delete process.env.TEST_COPY;
  else process.env.TEST_COPY = before;
});

describe('the test-copy switch', () => {
  it('is on only when TEST_COPY is exactly "1"', () => {
    delete process.env.TEST_COPY;
    expect(isTestCopy()).toBe(false);
    for (const value of ['', '0', 'true', 'yes', ' 1', '11']) {
      process.env.TEST_COPY = value;
      expect(isTestCopy()).toBe(false);
    }
    process.env.TEST_COPY = '1';
    expect(isTestCopy()).toBe(true);
  });

  it('the tag says the names are made up, on both screens', () => {
    expect(copy.testCopy.tag).toBe('Test copy');
    expect(copy.testCopy.dashboard).toMatch(/made up/);
    expect(copy.testCopy.dashboard).toMatch(/real people/);
    expect(copy.testCopy.kiosk).toMatch(/made up/);
  });
});

describe('where made-up rows may be seeded', () => {
  const hosted = 'postgres://user:pw@db.example.com/main?sslmode=require';

  it('a database on this machine may always be seeded', () => {
    expect(seedRefusal('postgres://postgres:postgres@127.0.0.1:54329/signin', false)).toBeNull();
    expect(seedRefusal('postgres://postgres:postgres@localhost:54329/signin', false)).toBeNull();
  });

  it('a hosted database is refused unless it belongs to a test copy', () => {
    expect(seedRefusal(hosted, false)).toMatch(/Refusing to seed/);
    expect(seedRefusal(hosted, true)).toBeNull();
  });

  it('a script names the database it touches without giving the address or the password away', () => {
    expect(describeDatabase('postgres://postgres:postgres@127.0.0.1:54329/signin')).toBe('on this machine');
    const said = describeDatabase('postgres://user:s3cret@ep-some-name-123.us-east-1.aws.example.tech/main');
    expect(said).toBe('hosted, at *.example.tech');
    expect(said).not.toMatch(/s3cret|ep-some-name|user/);
  });
});
