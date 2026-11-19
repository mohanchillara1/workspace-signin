import { copy } from './copy';

export type ErrorKey = keyof typeof copy.errors;

/**
 * An error whose message is written for the person at the screen. It is made
 * from a key in copy.errors, so the words live with all the other words.
 * Anything else that goes wrong (a database fault, a bug) is shown as a
 * plain "something went wrong", and internals never reach a page.
 */
export class UserError extends Error {
  constructor(public readonly key: ErrorKey) {
    super(copy.errors[key]);
  }
}

/** The key to put in a link for an error, and the words for a key from a link. */
export function errorKey(error: unknown): ErrorKey {
  return error instanceof UserError ? error.key : 'generic';
}

export function errorText(key: unknown): string {
  return typeof key === 'string' && Object.hasOwn(copy.errors, key) ? copy.errors[key as ErrorKey] : copy.errors.generic;
}
