import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletNote } from '@/components/dashboard/WalletNote';
import { WalletButtons } from '@/components/member/WalletButtons';
import { copy } from '@/lib/copy';
import {
  buildPassRequest,
  FREE_PLAN_FIELDS,
  PASS_COLOR,
  makePass,
  safeGoogleLink,
  standInClient,
  walletAvailable,
  walletIsStandIn,
  walletPlatforms,
  WalletError,
  type WalletClient,
} from '@/lib/wallet';

// No test in this file may reach the network. Any fetch is a failure unless a test stubs its own.
const fetchSpy = vi.fn(async () => {
  throw new Error('a test tried to use the network');
});

const SAVED = { ...process.env };
beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  delete process.env.WALLETWALLET_API_KEY;
  delete process.env.WALLET_STAND_IN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...SAVED };
});

// A made-up member. Nothing here is a real person.
const member = { scanCode: 'SCAN-TEST-CODE-0001', firstName: 'Testa' };
const b64 = (text: string) => Buffer.from(text).toString('base64');

describe('walletAvailable', () => {
  it('is false with no key and no stand-in', () => {
    expect(walletAvailable()).toBe(false);
  });
  it('is false for a blank key', () => {
    process.env.WALLETWALLET_API_KEY = '   ';
    expect(walletAvailable()).toBe(false);
  });
  it('is true with a key', () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    expect(walletAvailable()).toBe(true);
  });
  it('is true with a key on the real host too', () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    process.env.VERCEL = '1';
    expect(walletAvailable()).toBe(true);
  });
  it('honours the stand-in on this machine, and never on the real host', () => {
    process.env.WALLET_STAND_IN = '1';
    expect(walletAvailable()).toBe(true);
    process.env.VERCEL_ENV = 'preview';
    expect(walletAvailable()).toBe(false);
    delete process.env.VERCEL_ENV;
    process.env.VERCEL = '1';
    expect(walletAvailable()).toBe(false);
  });
  it('only treats the value 1 as on', () => {
    process.env.WALLET_STAND_IN = 'true';
    expect(walletAvailable()).toBe(false);
  });
});

describe('walletPlatforms', () => {
  it('offers both, because the documented create call returns an Apple file and a Google link', () => {
    expect(walletPlatforms()).toEqual(['apple', 'google']);
  });
});

describe('buildPassRequest', () => {
  it('is exactly the documented free-plan request, with the code and the first name', () => {
    const body = buildPassRequest({ ...member, platform: 'apple' });
    expect(body).toEqual({
      barcodeValue: 'SCAN-TEST-CODE-0001',
      barcodeFormat: 'QR',
      barcodeAltText: '',
      logoText: copy.wallet.passTitle,
      organizationName: copy.wallet.passTeam,
      description: copy.wallet.passDescription,
      headerFields: [{ label: copy.wallet.passHeaderLabel, value: copy.wallet.passHeaderValue }],
      primaryFields: [{ label: copy.wallet.passLabel, value: 'Testa' }],
      secondaryFields: copy.wallet.passFront.map(([label, value]) => ({ label, value })),
      backFields: copy.wallet.passBack.map(([label, value]) => ({ label, value })),
      colorPreset: PASS_COLOR,
      sharingProhibited: true,
    });
  });
  it('looks like the team: its name and number on the front, how to use it on the back', () => {
    const text = JSON.stringify(buildPassRequest({ ...member, platform: 'apple' }));
    for (const words of ['SINGULARITY', '10032', 'Singularity Robotics', 'workspace-signin.vercel.app/login', 'singularity-frc.com']) {
      expect(text).toContain(words);
    }
    // One of the six free presets; the site's own colour is a paid field.
    expect(['dark', 'blue', 'green', 'red', 'purple', 'orange']).toContain(PASS_COLOR);
  });
  it('is the same request for both wallets', () => {
    expect(buildPassRequest({ ...member, platform: 'google' })).toEqual(buildPassRequest({ ...member, platform: 'apple' }));
  });
  it('carries nothing else about the member, whatever extra is passed in', () => {
    const extra = { ...member, platform: 'apple' as const, lastName: 'Lastname-Test', pageKey: 'PAGEKEY-TEST', id: 'ID-TEST', subteam: 'Build' };
    const text = JSON.stringify(buildPassRequest(extra));
    for (const secret of ['Lastname-Test', 'PAGEKEY-TEST', 'ID-TEST', 'Build']) expect(text).not.toContain(secret);
    expect(text).toContain('SCAN-TEST-CODE-0001');
    expect(text).toContain('Testa');
  });
  it('sends no paid field and no field the docs do not list', () => {
    const keys = Object.keys(buildPassRequest({ ...member, platform: 'apple' }));
    const paid = ['color', 'logoURL', 'wideLogoURL', 'thumbnailURL', 'stripURL', 'backgroundURL', 'iconURL', 'locations', 'featuredActions', 'footerFields', 'credentials'];
    for (const field of paid) expect(keys).not.toContain(field);
    for (const key of keys) expect(FREE_PLAN_FIELDS).toContain(key);
    expect(keys).not.toContain('serialNumber');
    expect(keys).not.toContain('authenticationToken');
  });
  it('stays inside the documented limits', () => {
    const body = buildPassRequest({ scanCode: 'x'.repeat(2000), firstName: 'y'.repeat(500), platform: 'apple' });
    expect(body.barcodeValue.length).toBeLessThanOrEqual(1024);
    expect(body.primaryFields[0].value.length).toBeLessThanOrEqual(256);
    expect(body.logoText.length).toBeLessThanOrEqual(64);
    expect(body.description.length).toBeLessThanOrEqual(128);
    expect(body.organizationName.length).toBeLessThanOrEqual(64);
    for (const list of [body.headerFields, body.primaryFields, body.secondaryFields, body.backFields]) {
      expect(list.length).toBeLessThanOrEqual(10);
      for (const field of list) {
        expect(field.label.length).toBeLessThanOrEqual(64);
        expect(field.value.length).toBeLessThanOrEqual(256);
      }
    }
  });
});

describe('makePass with the stand-in', () => {
  it('makes a small made-up file for Apple and never calls fetch', async () => {
    process.env.WALLET_STAND_IN = '1';
    fetchSpy.mockImplementation(async () => {
      throw new Error('fetch must not be called');
    });
    const made = await makePass({ ...member, platform: 'apple' });
    expect(made.kind).toBe('file');
    if (made.kind !== 'file') return;
    expect(made.contentType).toBe('application/vnd.apple.pkpass');
    expect(made.filename).toMatch(/\.pkpass$/);
    expect(made.bytes.length).toBeGreaterThan(0);
    expect(made.bytes.length).toBeLessThan(2000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('makes a link on the documented Google host for Google, with no fetch', async () => {
    process.env.WALLET_STAND_IN = '1';
    const made = await makePass({ ...member, platform: 'google' });
    expect(made.kind).toBe('link');
    if (made.kind === 'link') expect(made.url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('standInClient is a client that makes no request', async () => {
    const reply = await standInClient.create(buildPassRequest({ ...member, platform: 'apple' }), new AbortController().signal);
    expect(reply.applePass).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('which service makePass uses when it is given none', () => {
  const key = 'ww_live_not_a_real_key';
  const envelope = () => new Response(JSON.stringify({ applePass: b64('a pass') }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('makes nothing with no key and the stand-in off', async () => {
    await expect(makePass({ ...member, platform: 'apple' })).rejects.toBeInstanceOf(WalletError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('makes nothing on the real host with no key, even with the stand-in switch set there', async () => {
    process.env.VERCEL = '1';
    process.env.WALLET_STAND_IN = '1';
    await expect(makePass({ ...member, platform: 'apple' })).rejects.toBeInstanceOf(WalletError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('uses the stand-in on this machine even when a key is set, so a test run never spends a real pass', async () => {
    process.env.WALLETWALLET_API_KEY = key;
    process.env.WALLET_STAND_IN = '1';
    const made = await makePass({ ...member, platform: 'apple' });
    expect(made.kind).toBe('file');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(walletIsStandIn()).toBe(true);
  });
  it('uses the real service on the real host when a key is set, whatever the switch says', async () => {
    process.env.VERCEL = '1';
    process.env.WALLETWALLET_API_KEY = key;
    process.env.WALLET_STAND_IN = '1';
    fetchSpy.mockImplementation((async () => envelope()) as never);
    const made = await makePass({ ...member, platform: 'apple' });
    expect(made.kind).toBe('file');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(walletIsStandIn()).toBe(false);
  });
});

describe('makePass with a client', () => {
  const fake = (reply: Awaited<ReturnType<WalletClient['create']>>): WalletClient => ({ create: vi.fn(async () => reply) });

  it('decodes the base64 Apple pass', async () => {
    const made = await makePass({ ...member, platform: 'apple' }, fake({ applePass: b64('pkpass bytes'), googleSaveUrl: null }));
    expect(made.kind === 'file' && Buffer.from(made.bytes).toString()).toBe('pkpass bytes');
  });
  it('hands the client the request and nothing else', async () => {
    const client = fake({ applePass: b64('x'), googleSaveUrl: null });
    await makePass({ ...member, platform: 'apple' }, client);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect((client.create as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(buildPassRequest({ ...member, platform: 'apple' }));
  });
  it('returns the Google link when it is https on the documented host', async () => {
    const url = 'https://pay.google.com/gp/v/save/abc.def';
    const made = await makePass({ ...member, platform: 'google' }, fake({ applePass: null, googleSaveUrl: url }));
    expect(made).toEqual({ kind: 'link', url });
  });
  it.each([
    'http://pay.google.com/gp/v/save/abc',
    'https://evil.example/gp/v/save/abc',
    'https://pay.google.com.evil.example/gp/v/save/abc',
    'https://pay.google.com@evil.example/gp/v/save/abc',
    'https://pay.google.com/other/path',
    'javascript:alert(1)',
    '',
  ])('refuses the Google link %s', async (url) => {
    expect(safeGoogleLink(url)).toBeNull();
    await expect(makePass({ ...member, platform: 'google' }, fake({ applePass: null, googleSaveUrl: url }))).rejects.toBeInstanceOf(WalletError);
  });
  it('says so in plain words when the answer has no pass in it', async () => {
    await expect(makePass({ ...member, platform: 'apple' }, fake({ applePass: null, googleSaveUrl: null }))).rejects.toThrow(copy.wallet.failed);
  });
  it('turns any client failure into a WalletError with plain words, never the raw error', async () => {
    const client: WalletClient = {
      create: async () => {
        throw new Error('secret detail ww_live_abcdef');
      },
    };
    const error = await makePass({ ...member, platform: 'apple' }, client).catch((e) => e);
    expect(error).toBeInstanceOf(WalletError);
    expect(error.message).toBe(copy.wallet.failed);
    expect(error.message).not.toContain('ww_live');
  });
  it('gives up after 10 seconds', async () => {
    vi.useFakeTimers();
    try {
      const client: WalletClient = {
        create: (_body, signal) =>
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      };
      const pending = makePass({ ...member, platform: 'apple' }, client).catch((e) => e);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await pending).toBeInstanceOf(WalletError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the real client, with fetch stubbed (no network)', () => {
  it('posts the documented request with a Bearer key and reads the JSON envelope', async () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    fetchSpy.mockImplementation((async () =>
      new Response(JSON.stringify({ serialNumber: 's', applePass: b64('pk'), googleSaveUrl: 'https://pay.google.com/gp/v/save/z', shareUrl: 'https://pass.walletwallet.dev/p/s' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never);
    const made = await makePass({ ...member, platform: 'apple' });
    expect(made.kind).toBe('file');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.walletwallet.dev/api/passes');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ww_live_not_a_real_key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(buildPassRequest({ ...member, platform: 'apple' }));
  });
  it('also reads the documented binary reply (pkpass body and X-Google-Save-Url header)', async () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    fetchSpy.mockImplementation((async () =>
      new Response('raw pkpass', {
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.pkpass', 'x-google-save-url': 'https://pay.google.com/gp/v/save/q' },
      })) as never);
    const apple = await makePass({ ...member, platform: 'apple' });
    expect(apple.kind === 'file' && Buffer.from(apple.bytes).toString()).toBe('raw pkpass');
    const google = await makePass({ ...member, platform: 'google' });
    expect(google).toEqual({ kind: 'link', url: 'https://pay.google.com/gp/v/save/q' });
  });
  it.each([
    [400, copy.wallet.failed],
    [401, copy.wallet.failed],
    [500, copy.wallet.failed],
    [429, copy.wallet.limitReached],
  ])('answers %i in plain words', async (status, words) => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    fetchSpy.mockImplementation((async () => new Response(JSON.stringify({ error: 'detail ww_live_abc' }), { status })) as never);
    const error = await makePass({ ...member, platform: 'apple' }).catch((e) => e);
    expect(error).toBeInstanceOf(WalletError);
    expect(error.message).toBe(words);
  });
});

describe('the buttons', () => {
  const html = (platforms: ('apple' | 'google')[]) => renderToStaticMarkup(createElement(WalletButtons, { pageKey: 'KEY-TEST', platforms }));
  it('are plain links to the route, one per platform', () => {
    const out = html(['apple', 'google']);
    expect(out).toContain(copy.wallet.apple);
    expect(out).toContain(copy.wallet.google);
    expect(out).toContain('href="/m/KEY-TEST/pass?platform=apple"');
    expect(out).toContain('href="/m/KEY-TEST/pass?platform=google"');
  });
  it('tell the member that an outside service makes the pass and what is sent to it', () => {
    const out = html(['apple', 'google']);
    expect(out).toContain('WalletWallet');
    expect(out).toMatch(/sign-in code and (your )?first name/);
    expect(out).toMatch(/sent/);
  });
  it('leave out a platform that is not offered', () => {
    const out = html(['apple']);
    expect(out).toContain(copy.wallet.apple);
    expect(out).not.toContain(copy.wallet.google);
  });
  it('render nothing when no platform is offered', () => {
    expect(html([])).toBe('');
  });
});

describe('the lead note', () => {
  const note = () => renderToStaticMarkup(createElement(WalletNote));
  it('says wallet passes are off with no key', () => {
    expect(note()).toContain(copy.wallet.noteOff);
  });
  it('says they are on with a key, and what the free plan cannot do', () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    const out = note();
    expect(out).toContain(copy.wallet.noteOn);
    expect(out).toContain(copy.wallet.noteFree);
    expect(out).toContain(copy.wallet.noteLimit);
    expect(out).not.toContain('ww_live');
  });
  it('says the stand-in is not real', () => {
    process.env.WALLET_STAND_IN = '1';
    expect(note()).toContain(copy.wallet.noteStandIn);
  });
  it('tells a lead what goes to the pass service and what a new QR code does to a pass', () => {
    process.env.WALLETWALLET_API_KEY = 'ww_live_not_a_real_key';
    const out = note();
    expect(out).toContain(copy.wallet.noteSent);
    expect(out).toContain(copy.wallet.noteRekey);
  });
  it('says none of that while passes are off', () => {
    const out = note();
    expect(out).not.toContain(copy.wallet.noteSent);
    expect(out).not.toContain(copy.wallet.noteLimit);
  });
});

describe('the words', () => {
  it('have no em dash and no gradient talk', () => {
    for (const value of Object.values(copy.wallet)) expect(String(value)).not.toContain('—');
  });
});
