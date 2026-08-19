/**
 * Epoch seconds. Every caller reads it once and threads the number down as
 * data, so nothing below the read can disagree about what time it is.
 *
 * Deliberately NOT an injectable seam. A clock parameter through nine routes
 * would buy only what `vi.setSystemTime` already hands a test for free, and
 * sitting next to `htmlResponse` in http.ts is what made it read as one. Zero
 * imports, so the CLI and the browser bundle share this spelling too.
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}
