// "Add to Wallet" on a member's page: makes a pass that holds the member's scan
// code (as a QR code) and first name, through the pass-signing service
// WalletWallet.
//
// ---- The service details live here, in one place, so they are easy to fix. ----
// Read from WalletWallet's own pages with curl on 2026-11-19. Read, not run:
// no request has ever been sent, so nothing below has been seen to work.
//   https://www.walletwallet.dev/llms.txt   (API reference, linked from its home page)
//   https://www.walletwallet.dev/docs/      https://www.walletwallet.dev/pricing/
//   endpoint  POST https://api.walletwallet.dev/api/passes  (one call, both wallets)
//   headers   Authorization: Bearer ww_live_<key>, Content-Type: application/json
//   body      barcodeValue, barcodeFormat "QR", barcodeAltText, logoText,
//             description, organizationName, primaryFields [{label, value}],
//             colorPreset, sharingProhibited. These are all free-plan fields.
//   reply     JSON { serialNumber, googleSaveUrl, applePass (base64 .pkpass),
//             shareUrl }. The legacy binary shape is also read: the .pkpass as
//             the body and the Google link in the X-Google-Save-Url header.
//   google    googleSaveUrl is "https://pay.google.com/gp/v/save/<jwt>"
//   free plan "1,000 passes/month (creations + updates)"; "One pass covers Apple
//             and Google and counts once". A custom colour, logo, strip, thumbnail,
//             background, icon, locations and own certificates are Pro.
//   errors    JSON { error }; 400 validation, 401 key, 429 monthly limit, 500.
// The first real call is the first test of this request shape. The docs disagree with
// themselves once on whether POST /api/passes answers JSON or the file; both
// are read here.
// -------------------------------------------------------------------------------
import type { Db } from './db/client';
import { copy } from './copy';
import { memberByPageKey } from './members';
import { hit } from './rate-limit';

export const API_URL = 'https://api.walletwallet.dev/api/passes';
export const TIMEOUT_MS = 10_000;
export const PASS_CONTENT_TYPE = 'application/vnd.apple.pkpass';
/** The only host and path a Google link may have, from the docs. */
export const GOOGLE_HOST = 'pay.google.com';
export const GOOGLE_PATH = '/gp/v/save/';
/** Passes one address may ask for in a minute. */
export const PASSES_A_MINUTE = 10;
/** For one member, from any address. A pass never changes, so one is enough; each one counts against the month. */
export const PASSES_A_DAY_EACH = 5;

/** Every field the request may carry. All are free-plan fields in the docs. */
export const FREE_PLAN_FIELDS = [
  'barcodeValue',
  'barcodeFormat',
  'barcodeAltText',
  'logoText',
  'description',
  'organizationName',
  'primaryFields',
  'colorPreset',
  'sharingProhibited',
] as const;

export type Platform = 'apple' | 'google';

export type PassRequest = {
  barcodeValue: string;
  barcodeFormat: 'QR';
  barcodeAltText: string;
  logoText: string;
  description: string;
  organizationName: string;
  primaryFields: { label: string; value: string }[];
  colorPreset: 'dark';
  sharingProhibited: true;
};

/** What the service gives back for one create call. */
export type PassReply = { applePass: string | null; googleSaveUrl: string | null };

/** The small shape the real client and the stand-in both meet. */
export interface WalletClient {
  create(body: PassRequest, signal: AbortSignal): Promise<PassReply>;
}

export type MadePass =
  | { kind: 'file'; contentType: string; filename: string; bytes: Uint8Array }
  | { kind: 'link'; url: string };

/** An error whose message is already plain words for the member. */
export class WalletError extends Error {}

// ---------- Which mode ----------

function standInOn(): boolean {
  // Never on the real host, whichever of its environments this is. The
  // stand-in is for this machine's tests and review copies only.
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) return false;
  return process.env.WALLET_STAND_IN === '1';
}

function apiKey(): string {
  return (process.env.WALLETWALLET_API_KEY ?? '').trim();
}

/** True when a key is set, or the test stand-in is on (never in production). */
export function walletAvailable(): boolean {
  return apiKey() !== '' || standInOn();
}

/**
 * True when passes come from the stand-in. For the lead's note. With the
 * stand-in on it wins over a key, so a test run on a machine that has a real
 * key never spends a real pass.
 */
export function walletIsStandIn(): boolean {
  return standInOn();
}

/** What the documented create call can really make: an Apple file and a Google link. */
export function walletPlatforms(): Platform[] {
  return ['apple', 'google'];
}

// ---------- The request ----------

const cut = (text: unknown, max: number) => String(text ?? '').slice(0, max);

/**
 * The documented request, free-plan fields only. Takes the scan code and the
 * first name and reads nothing else, even if more is passed in. The platform
 * does not change the request: one call serves both wallets.
 */
export function buildPassRequest(input: { scanCode: string; firstName: string; platform: Platform }): PassRequest {
  const w = copy.wallet;
  return {
    barcodeValue: cut(input.scanCode, 1024),
    barcodeFormat: 'QR',
    // An empty string shows no text under the code on either wallet (docs).
    barcodeAltText: '',
    logoText: cut(w.passTitle, 64),
    organizationName: cut(w.passTeam, 64),
    description: cut(w.passDescription, 128),
    primaryFields: [{ label: cut(w.passLabel, 64), value: cut(input.firstName, 256) }],
    colorPreset: 'dark',
    sharingProhibited: true,
  };
}

// ---------- The clients ----------

/** The link the Google button may follow: https, the documented host and path, nothing hidden in it. */
export function safeGoogleLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== GOOGLE_HOST || url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!url.pathname.startsWith(GOOGLE_PATH) || url.pathname.length === GOOGLE_PATH.length) return null;
  return url.toString();
}

/** A client that makes no network request. Returns a small made-up file. */
export const standInClient: WalletClient = {
  async create() {
    return {
      applePass: Buffer.from('Stand-in pass for testing. This is not a real wallet pass.').toString('base64'),
      googleSaveUrl: 'https://pay.google.com/gp/v/save/stand-in-not-a-real-pass',
    };
  },
};

/** The real client. The key is read here and is never put in an error or a log. */
function realClient(key: string): WalletClient {
  return {
    async create(body, signal) {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (response.status === 429) throw new WalletError(copy.wallet.limitReached);
      if (!response.ok) throw new WalletError(copy.wallet.failed);
      const type = response.headers.get('content-type') ?? '';
      if (type.includes(PASS_CONTENT_TYPE)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return { applePass: bytes.toString('base64'), googleSaveUrl: response.headers.get('x-google-save-url') };
      }
      const data = (await response.json()) as { applePass?: unknown; googleSaveUrl?: unknown };
      return {
        applePass: typeof data.applePass === 'string' ? data.applePass : null,
        googleSaveUrl: typeof data.googleSaveUrl === 'string' ? data.googleSaveUrl : null,
      };
    },
  };
}

/** The stand-in when it is on, else the real service when there is a key, else nothing. */
function defaultClient(): WalletClient {
  if (standInOn()) return standInClient;
  const key = apiKey();
  // Off. Without this a caller that skipped walletAvailable() would hand out a made-up pass.
  if (!key) throw new WalletError(copy.wallet.failed);
  return realClient(key);
}

// ---------- Making a pass ----------

/** Makes one pass. Throws a WalletError with plain words, after 10 seconds at most. */
export async function makePass(
  input: { scanCode: string; firstName: string; platform: Platform },
  client?: WalletClient,
): Promise<MadePass> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const reply = await (client ?? defaultClient()).create(buildPassRequest(input), controller.signal);
    if (input.platform === 'google') {
      const url = safeGoogleLink(reply.googleSaveUrl);
      if (!url) throw new WalletError(copy.wallet.failed);
      return { kind: 'link', url };
    }
    if (!reply.applePass) throw new WalletError(copy.wallet.failed);
    const bytes = new Uint8Array(Buffer.from(reply.applePass, 'base64'));
    if (bytes.length === 0) throw new WalletError(copy.wallet.failed);
    return { kind: 'file', contentType: PASS_CONTENT_TYPE, filename: 'singularity-pass.pkpass', bytes };
  } catch (error) {
    // Whatever went wrong, the member reads plain words and never the raw error.
    if (error instanceof WalletError) throw error;
    throw new WalletError(copy.wallet.failed);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- The route's logic, without the web framework ----------

export type ServeAnswer =
  | { status: 200; made: MadePass }
  | { status: 404 }
  | { status: 429 | 502; message: string };

/**
 * What GET /m/<page key>/pass answers. Off, a wrong key, an inactive member and
 * an unknown platform all give the same 404.
 */
export async function servePass(
  db: Db,
  input: { key: string; platform: string | null; address: string; now: Date; client?: WalletClient },
): Promise<ServeAnswer> {
  if (!walletAvailable()) return { status: 404 };
  const platform = walletPlatforms().find((p) => p === input.platform);
  if (!platform) return { status: 404 };
  const allowed = await hit(db, { key: `wallet-pass:${input.address}`, limit: PASSES_A_MINUTE, windowSeconds: 60, now: input.now });
  if (!allowed.allowed) return { status: 429, message: copy.wallet.tooMany };
  const member = await memberByPageKey(db, input.key);
  if (!member) return { status: 404 };
  const today = await hit(db, { key: `wallet-pass-member:${member.id}`, limit: PASSES_A_DAY_EACH, windowSeconds: 86_400, now: input.now });
  if (!today.allowed) return { status: 429, message: copy.wallet.tooManyToday };
  try {
    const made = await makePass({ scanCode: member.scanCode, firstName: member.firstName, platform }, input.client);
    return { status: 200, made };
  } catch (error) {
    return { status: 502, message: error instanceof WalletError ? error.message : copy.wallet.failed };
  }
}
