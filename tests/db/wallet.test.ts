import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '@/lib/copy';
import { addMember, setActive } from '@/lib/members';
import { buildPassRequest, PASSES_A_DAY_EACH, servePass, type WalletClient } from '@/lib/wallet';
import { useTestDb } from '../setup/db';

const fetchSpy = vi.fn(async () => {
  throw new Error('a test tried to use the network');
});
const SAVED = { ...process.env };
beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  delete process.env.WALLETWALLET_API_KEY;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.WALLET_STAND_IN = '1';
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED };
});

describe('the pass route logic', () => {
  const getDb = useTestDb();
  const now = new Date('2026-11-19T20:00:10Z');
  let n = 0;
  const ask = (key: string, platform: string | null, address = `addr-${++n}`, client?: WalletClient) =>
    servePass(getDb(), { key, platform, address, now, client });

  it('serves the stand-in file for a real page key, with no network', async () => {
    const member = await addMember(getDb(), { firstName: 'Testa', lastName: 'Lastname-Test' }, null);
    const answer = await ask(member.pageKey, 'apple');
    expect(answer.status).toBe(200);
    if (answer.status !== 200 || answer.made.kind !== 'file') throw new Error('expected a file');
    expect(answer.made.contentType).toBe('application/vnd.apple.pkpass');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('serves a Google link for platform=google', async () => {
    const member = await addMember(getDb(), { firstName: 'Testb' }, null);
    const answer = await ask(member.pageKey, 'google');
    expect(answer.status === 200 && answer.made.kind).toBe('link');
  });

  it('gives the client this member scan code and first name and nothing else', async () => {
    const member = await addMember(getDb(), { firstName: 'Testc', lastName: 'Lastname-Test' }, null);
    const create = vi.fn(async () => ({ applePass: Buffer.from('x').toString('base64'), googleSaveUrl: null }));
    await ask(member.pageKey, 'apple', undefined, { create });
    expect(create.mock.calls[0]).toBeDefined();
    const body = (create.mock.calls[0] as unknown as [unknown])[0];
    expect(body).toEqual(buildPassRequest({ scanCode: member.scanCode, firstName: 'Testc', platform: 'apple' }));
    const text = JSON.stringify(body);
    for (const secret of ['Lastname-Test', member.pageKey, member.id]) expect(text).not.toContain(secret);
  });

  it('answers 404 for a wrong key, a short key and an unknown platform', async () => {
    const member = await addMember(getDb(), { firstName: 'Testd' }, null);
    expect((await ask('A'.repeat(32), 'apple')).status).toBe(404);
    expect((await ask('short', 'apple')).status).toBe(404);
    expect((await ask(member.pageKey, 'windows')).status).toBe(404);
    expect((await ask(member.pageKey, null)).status).toBe(404);
  });

  it('answers 404 for an inactive member, the same as a wrong key', async () => {
    const member = await addMember(getDb(), { firstName: 'Teste' }, null);
    await setActive(getDb(), member.id, false, null);
    const gone = await ask(member.pageKey, 'apple');
    const wrong = await ask('A'.repeat(32), 'apple');
    expect(gone).toEqual(wrong);
    expect(gone.status).toBe(404);
  });

  it('answers 404 when wallet passes are off, even for a real member', async () => {
    const member = await addMember(getDb(), { firstName: 'Testf' }, null);
    delete process.env.WALLET_STAND_IN;
    expect((await ask(member.pageKey, 'apple')).status).toBe(404);
    process.env.WALLET_STAND_IN = '1';
    process.env.VERCEL = '1';
    expect((await ask(member.pageKey, 'apple')).status).toBe(404);
  });

  it('limits each address, and counts other addresses separately', async () => {
    // Three members take turns, so this is the limit on the address and not the one on each member.
    const three = [];
    for (const firstName of ['Testg', 'Testh', 'Testi']) three.push(await addMember(getDb(), { firstName }, null));
    const answers = [];
    for (let i = 0; i < 12; i++) answers.push(await ask(three[i % 3].pageKey, 'apple', 'busy-address'));
    expect(answers.slice(0, 10).every((a) => a.status === 200)).toBe(true);
    expect(answers.slice(10)).toEqual([{ status: 429, message: copy.wallet.tooMany }, { status: 429, message: copy.wallet.tooMany }]);
    expect((await ask(three[1].pageKey, 'apple', 'other-address')).status).toBe(200);
  });

  it('limits each member to a few passes a day, whatever address asks, and says so in plain words', async () => {
    // Every pass counts against the month's allowance, and a pass never changes, so one member needs one.
    const member = await addMember(getDb(), { firstName: 'Testa', lastName: 'Daily-Test' }, null);
    const other = await addMember(getDb(), { firstName: 'Testo', lastName: 'Daily-Test' }, null);
    for (let i = 0; i < PASSES_A_DAY_EACH; i++) expect((await ask(member.pageKey, 'apple')).status).toBe(200);
    const refused = await ask(member.pageKey, 'google');
    expect(refused).toEqual({ status: 429, message: copy.wallet.tooManyToday });
    expect((await ask(other.pageKey, 'apple')).status).toBe(200);
    const tomorrow = new Date(now.getTime() + 24 * 3600_000 + 1000);
    expect((await servePass(getDb(), { key: member.pageKey, platform: 'apple', address: 'addr-tomorrow', now: tomorrow })).status).toBe(200);
  });

  it('answers 502 with plain words when the service fails', async () => {
    const member = await addMember(getDb(), { firstName: 'Testh' }, null);
    const answer = await ask(member.pageKey, 'apple', undefined, {
      create: async () => {
        throw new Error('boom ww_live_secret');
      },
    });
    expect(answer.status).toBe(502);
    if (answer.status === 502) expect(answer.message).toBe(copy.wallet.failed);
  });
});
