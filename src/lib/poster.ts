/**
 * Poster frames, for the unfurl card.
 *
 * A video URL shows nothing in Slack on its own: the crawler reads og:, oEmbed,
 * and twitter: tags and needs a real image to build a card, and no frame can be
 * cut out of a video inside a Worker. So the CLI cuts one at upload and sends it
 * alongside, named off its parent.
 *
 * The bytes land at `f/<parent>.poster.jpg` like any upload, but the record
 * hangs off the parent's `MetaFile` instead of joining `files`. That keeps the
 * file count, the directory listing, the admin tiles, and the single-file link
 * blind to it, so no caller needs a filter.
 */

const SUFFIX = '.poster.jpg';

export function posterPath(filePath: string): string {
  return `${filePath}${SUFFIX}`;
}

/** The upload a poster belongs to, or null when the name is not one. */
export function posterParent(filePath: string): string | null {
  if (!filePath.endsWith(SUFFIX)) return null;
  const parent = filePath.slice(0, -SUFFIX.length);
  return parent === '' ? null : parent;
}
