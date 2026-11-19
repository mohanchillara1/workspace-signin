import { createHash, randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O or U, so a code read aloud is not misheard.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SCAN_CODE_PATTERN = /^SR1-[0-9A-HJKMNP-TV-Z]{26}$/;

/** The code inside a member's QR: a prefix and 130 random bits. */
export function newScanCode(): string {
  let body = '';
  for (const byte of randomBytes(26)) body += ALPHABET[byte % 32];
  return `SR1-${body}`;
}

/** The key in a member's private page link: 192 random bits. */
export function newPageKey(): string {
  return randomBytes(24).toString('base64url');
}

/** A one-time secret for invite links and kiosk pairing: 256 random bits. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed id. Anything else never reaches the database. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
