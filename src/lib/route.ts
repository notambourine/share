/** Parsing a share URL: the decoded segments the router dispatches on, and the
    artifact tail everything downstream of the dispatch reads. */

/**
 * Where a request points and what it may print.
 *
 * The bytes used to resolve from `rest` while the hrefs re-derived themselves
 * from `request.url`, two sources for one truth with nothing asserting they
 * agreed. Both come from here now, so they cannot drift.
 */
export interface ParsedRoute {
  space: string;
  hash: string;
  /** The `/k/<token>/` view token; null on an open link. */
  token: string | null;
  /** Path under the artifact root; `''` is the root itself. */
  rest: string;
  origin: string;
  /** Artifact root, token segment included, with a trailing slash. */
  root: string;
  /** The directory `rest` sits in, with a trailing slash. */
  dir: string;
  /** The requested URL without its query. */
  page: string;
}

/** Null on bad percent-encoding, which is the router's 404. */
export function pathSegments(path: string): string[] | null {
  try {
    return path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

/**
 * Structural only. Which segments are a space and a hash at all is the
 * dispatcher's call, because that ordering is the security model.
 */
export function parseRoute(url: URL, segs: string[]): ParsedRoute {
  const [space, hash] = segs;
  const signed = segs[2] === 'k' && segs.length >= 4;
  const token = signed ? segs[3] : null;
  const { origin, pathname } = url;
  return {
    space,
    hash,
    token,
    rest: segs.slice(signed ? 4 : 2).join('/'),
    origin,
    /* Built from the segments rather than sliced off the pathname: the poster is
       a sibling of the file, not of the URL, and a request under a subdirectory
       would otherwise hang it off the wrong base. */
    root: `${origin}/${space}/${hash}/${token ? `k/${token}/` : ''}`,
    dir: `${origin}${pathname.slice(0, pathname.lastIndexOf('/') + 1)}`,
    page: `${origin}${pathname}`,
  };
}
