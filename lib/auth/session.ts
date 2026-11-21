// The parts of login and kiosk pairing that touch cookies and headers. The
// rules themselves are in leads.ts and ../kiosk.ts, which need no browser.
import { getIronSession } from 'iron-session';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '../db/client';
import type { Kiosk, Member } from '../db/schema';
import { newToken } from '../ids';
import { kioskByToken } from '../kiosk';
import { endSession, leadForSession, SESSION_DAYS, type SessionData } from './leads';

const SESSION_SECONDS = 60 * 60 * 24 * SESSION_DAYS;
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
  // On the real host every request is https, whatever a header claims.
  if (process.env.VERCEL === '1') return true;
  const proto = (await headers()).get('x-forwarded-proto') ?? 'http';
  return proto.split(',')[0].trim() === 'https';
}

/** The address a request came from, for rate limits. */
export async function clientAddress(): Promise<string> {
  const all = await headers();
  // Prefer the headers the host itself sets and a visitor cannot forge. With
  // no proxy in front (this laptop), x-forwarded-for is whatever the caller
  // sent, so the per-address limits are only as good as the host.
  const trusted = all.get('x-vercel-forwarded-for') ?? all.get('x-real-ip');
  const forwarded = trusted ?? all.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || 'local';
}

/**
 * remember: true keeps the cookie for SESSION_DAYS; false makes it end when the
 * browser closes. Either way the server can still end it (log out, new invite).
 */
async function leadSession(remember = true) {
  return getIronSession<SessionData>(await cookies(), {
    cookieName: 'lead',
    password: secret(),
    ttl: SESSION_SECONDS,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: await isHttps(),
      path: '/',
      ...(remember ? {} : { maxAge: undefined }),
    },
  });
}

export async function signInLead(memberId: string, version: number, remember = true): Promise<void> {
  const session = await leadSession(remember);
  session.memberId = memberId;
  session.version = version;
  // Names this one login, so logging out here ends this session and no other.
  session.sid = newToken();
  await session.save();
}

/** Ends this session on the server, then clears the cookie. A copied cookie stops working too. */
export async function signOutLead(): Promise<void> {
  const session = await leadSession();
  await endSession(getDb(), session.sid);
  session.destroy();
}

/** The logged-in lead, or null. Checked against the database on every request. */
export async function currentLead(): Promise<Member | null> {
  const session = await leadSession();
  return leadForSession(getDb(), { memberId: session.memberId, version: session.version, sid: session.sid });
}

/** For every dashboard page and action: the lead, or a trip to the leads' login page. */
export async function requireLead(): Promise<Member> {
  const lead = await currentLead();
  if (!lead) redirect('/admin');
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

// A member who ticked "Keep me signed in" gets their page key in this cookie,
// so the login page sends them straight to their page next time. The page key
// is what opens their page anyway; the cookie only saves typing their name.
const MEMBER_COOKIE = 'member_page';

export async function rememberMember(pageKey: string): Promise<void> {
  (await cookies()).set(MEMBER_COOKIE, pageKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttps(),
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

export async function rememberedMemberKey(): Promise<string | null> {
  const value = (await cookies()).get(MEMBER_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{20,64}$/.test(value) ? value : null;
}

export async function forgetMember(): Promise<void> {
  (await cookies()).delete(MEMBER_COOKIE);
}
