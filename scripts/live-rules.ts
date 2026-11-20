// How live-check reads an answer from a hosted copy. Kept apart from the
// script so the rules can be tested without a host.

/** The host's own security checkpoint answered, not the app. Nothing can be concluded from it. */
export function isChallenge(headers: Headers): boolean {
  return headers.has('x-vercel-mitigated');
}

/** The host is asking for a Vercel login before it lets anyone reach the app. */
export function isLoginWall(status: number, headers: Headers): boolean {
  return (
    status === 401 ||
    /vercel\.com/.test(headers.get('location') ?? '') ||
    /_vercel_sso_nonce/.test(headers.get('set-cookie') ?? '')
  );
}

/**
 * The app itself answered. Said as what the app's answer looks like (it sends
 * its own noindex header on every path), not as "nothing went wrong", which
 * would pass on a checkpoint page too.
 */
export function isOurAnswer(status: number, headers: Headers): boolean {
  return !isChallenge(headers) && !isLoginWall(status, headers) && /noindex/.test(headers.get('x-robots-tag') ?? '');
}

/**
 * Which parts of the live check run.
 *   (nothing)       the signed-out pages and a few private files
 *   --no-private    the signed-out pages, and no private-looking address at all.
 *                   For a copy built from the repository: nothing local was
 *                   uploaded, and a run of such requests looks like a scanner.
 *   --loop          as above, then the whole loop in a browser
 *   --loop-only     the loop, with no signed-out request before it
 */
export function plan(args: string[]): { pages: boolean; privateFiles: boolean; loop: boolean } {
  const has = (name: string) => args.includes(`--${name}`);
  const pages = !has('loop-only');
  return { pages, privateFiles: pages && !has('no-private'), loop: has('loop') || has('loop-only') };
}

/** "1 address in 2 counts". The rate-limit table holds one row per time window, so rows are not addresses. */
export function addressSummary(addresses: string[]): string {
  const distinct = new Set(addresses).size;
  const rows = addresses.length;
  return `${distinct} ${distinct === 1 ? 'address' : 'addresses'} in ${rows} ${rows === 1 ? 'count' : 'counts'}`;
}

/** The last line of a run. A run in which nothing was checked is not a pass. */
export function verdict(ran: number, failed: number): { ok: boolean; text: string } {
  if (ran === 0) return { ok: false, text: 'No check ran, so nothing was shown' };
  if (failed > 0) return { ok: false, text: `${failed} of ${ran} checks FAILED` };
  return { ok: true, text: `${ran} checks ran. All passed` };
}
