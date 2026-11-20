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
