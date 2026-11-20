/**
 * True on a copy of the app that holds made-up names only (TEST_COPY=1). The
 * leads' screens and the kiosk say so, so nobody types a real roster into it.
 */
export function isTestCopy(): boolean {
  return process.env.TEST_COPY === '1';
}
