// The parts of login and kiosk pairing that touch cookies and headers. The
// rules themselves are in leads.ts and ../kiosk.ts, which need no browser.
import { getIronSession } from 'iron-session';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client';
import type { Kiosk, Member } from '../db/schema';
import { kioskByToken } from '../kiosk';
import { leadForSession } from './leads';

type LeadSession = { memberId?: string; version?: number };

const TWO_WEEKS = 60 * 60 * 24 * 14;
const KIOSK_COOKIE = 'kiosk';
const KIOSK_DAYS = 400;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SECRET is missing or shorter than 32 characters. See .env.example.');
  }
  return value;
}

/** True when the browser reached us over https. Cookies are marked Secure then. */
export async function isHttps(): Promise<boolean> {
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  return proto.split(',')[0].trim() === 'https';
}

/** The address a request came from, for rate limits. */
export async function clientAddress(): Promise<string> {
  const forwarded = (await headers()).get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || 'local';
}

async function leadSession() {
  return getIronSession<LeadSession>(await cookies(), {
    cookieName: 'lead',
    password: secret(),
    ttl: TWO_WEEKS,
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: await isHttps(), path: '/' },
  });
}

export async function signInLead(memberId: string, version: number): Promise<void> {
  const session = await leadSession();
  session.memberId = memberId;
  session.version = version;
  await session.save();
}

export async function signOutLead(): Promise<void> {
  (await leadSession()).destroy();
}

/** The logged-in lead, or null. Checked against the database on every request. */
export async function currentLead(): Promise<Member | null> {
  const session = await leadSession();
  return leadForSession(getDb(), { memberId: session.memberId, version: session.version });
}

/** For every dashboard page and action: the lead, or a trip to the login page. */
export async function requireLead(): Promise<Member> {
  const lead = await currentLead();
  if (!lead) redirect('/login');
  return lead;
}

/** The paired kiosk this browser is, or null. */
export async function currentKiosk(): Promise<Kiosk | null> {
  return kioskByToken(getDb(), (await cookies()).get(KIOSK_COOKIE)?.value);
}

export async function setKioskCookie(token: string): Promise<void> {
  (await cookies()).set(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttps(),
    path: '/',
    maxAge: KIOSK_DAYS * 86_400,
  });
}

/** Pushes the kiosk cookie's end date out again. Called when the scan page loads. */
export async function refreshKioskCookie(): Promise<void> {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  if (token) await setKioskCookie(token);
}

/**
 * Route handlers are not covered by the framework's own cross-site check, so
 * a POST must come from this site's own pages.
 */
export async function sameOrigin(request: Request): Promise<boolean> {
  const origin = request.headers.get('origin');
  if (!origin) return true; // not a browser cross-site request
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}
