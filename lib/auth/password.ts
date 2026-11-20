import { hash, verify } from '@node-rs/argon2';

// Argon2id with the settings OWASP lists as a minimum.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN = 5;
export const PASSWORD_MAX = 200;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}
