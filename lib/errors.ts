/**
 * An error whose message is written for the person at the screen. Anything
 * else that goes wrong (a database fault, a bug) is shown as a plain
 * "something went wrong", so internals never reach a page.
 */
export class UserError extends Error {}
