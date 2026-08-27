import { describe, expect, it } from 'vitest';
import { fileShell, indexShell, adminShell, errorShell, homeShell, type ShellView } from '../src/render/shell';
import type { ArtifactIndex } from '../src/lib/artifact';
import type { Meta } from '../src/lib/types';

const DECK: ShellView = { kind: 'slides', html: '<div></div>', css: '' };

/* An uploader names the file, and every shell puts that name in markup - in
   text, in a `download=`, in a `data-raw=`. Nothing in the render layer escapes
   by hand any more, so these are the tests that the JSX escape holds.

   No slash in this one: fileName() keeps only the last segment, so a payload
   spelled `</script>` would be trimmed away before a shell ever printed it. */
const HOSTILE = '<img src=x onerror=alert(1)>.txt';
/* The listings print the whole path, so that is where a slash payload belongs. */
const HOSTILE_PATH = 'a/"><script>alert(1)</script>.txt';
const ATTR_BREAK = 'a" onload="alert(1)';

function meta(paths: string[]): Meta {
  return {
    space: 'acme',
    hash: 'LCLC7zhWhmP4',
    uploader: 'test',
    createdAt: 1_700_000_000,
    expiresAt: null,
    files: paths.map((path) => ({ path, size: 17, type: 'text/plain; charset=utf-8' })),
  };
}

/** The index model a route would have gathered, built here so the shell tests
    never reach for a bucket. */
function index(paths: string[], stamped: string[] = []): ArtifactIndex {
  const file = (path: string) => ({
    path,
    size: 17,
    stamp: null,
    exports: path.endsWith('.md') ? [`${path.replace(/\.md$/, '')}.pdf`] : [],
  });
  return {
    space: 'acme',
    hash: 'LCLC7zhWhmP4',
    createdAt: 1_700_000_000,
    expiresAt: null,
    uploads: paths.map(file),
    generations: stamped.length === 0 ? [] : [{
      name: 'deck',
      versions: stamped.map((path) => ({ ...file(path), stamp: 1712 })),
    }],
    renders: [],
  };
}

describe('every shell escapes a hostile filename', () => {
  it('escapes it in the file shell, in text and in attributes', () => {
    const out = fileShell({ path: HOSTILE, rawHref: `/acme/h/${ATTR_BREAK}`, size: 17 }, { kind: 'download' });
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;.txt');
    expect(out).not.toContain('<img src=x');
    // The break-out attempt lands as data, not as a second attribute.
    expect(out).not.toContain('onload="alert(1)"');
    expect(out).toContain('a&quot; onload=&quot;alert(1)');
  });

  it('escapes it in the og tags a crawler reads', () => {
    const out = fileShell({ path: HOSTILE, rawHref: '/x?raw', pageHref: `https://share.test/${ATTR_BREAK}` }, { kind: 'image' });
    expect(out).toContain('og:title" content="&lt;img src=x onerror=alert(1)&gt;.txt"');
    expect(out).not.toContain('onload="alert(1)"');
  });

  it('escapes it in the index listing', () => {
    const out = indexShell(index([HOSTILE_PATH]), meta([HOSTILE_PATH]));
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes it across the admin page, tiles and file list alike', () => {
    const out = adminShell({
      meta: meta([HOSTILE_PATH, 'deck.md']),
      origin: 'https://share.test',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('the shells still render what the client scripts select on', () => {
  it('keeps the presence attributes render.js and admin.js query', () => {
    const admin = adminShell({
      meta: meta(['deck.md']),
      origin: 'https://share.test',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    for (const attr of [
      'data-copylink', 'data-arm', 'data-fire', 'data-disarm', 'data-countdown',
      'data-exp', 'data-ttl', 'data-copy-href', 'data-genform', 'data-genstate',
    ]) {
      expect(admin).toContain(attr);
    }
  });

  /* The generate control is a form, not a click handler: the POST is a
     navigation, which is what lets the new tab hold through the model call
     instead of the page polling for a result. */
  it('generates through a form that posts into a new tab, with no action in the markup', () => {
    const admin = adminShell({
      meta: meta(['deck.md']),
      origin: 'https://share.test',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    expect(admin).toContain('method="post"');
    expect(admin).toContain('target="_blank"');
    expect(admin).toContain('name="sources"');
    expect(admin).toContain('type="submit"');
    // The action carries the ?c= token, so admin.js fills it in at runtime.
    expect(admin).not.toContain('action=');
  });

  it('keeps data-kind on the body, and no data-raw, because nothing fetches', () => {
    const out = fileShell({ path: 'deck.md', rawHref: '/acme/h/deck.md?raw' }, DECK);
    expect(out).toContain('data-kind="slides"');
    expect(out).not.toContain('data-raw');
  });

  it('gives the deck nav its prev, next, and count hooks', () => {
    const out = fileShell({ path: 'deck.md', rawHref: '/x?raw' }, DECK);
    for (const attr of ['data-prev', 'data-next', 'data-count']) {
      expect(out).toContain(attr);
    }
  });

  it('puts a copy button on an artifact page but not on the landing page', () => {
    expect(fileShell({ path: 'a.ts', rawHref: '/x?raw' }, { kind: 'code', html: '<pre></pre>' })).toContain('data-copy');
    expect(homeShell()).not.toContain('data-copy');
  });
});

describe('the shells keep their doctype and their chrome', () => {
  it('opens every page with a doctype', () => {
    expect(homeShell().startsWith('<!doctype html>')).toBe(true);
    expect(errorShell(404).startsWith('<!doctype html>')).toBe(true);
    expect(fileShell({ path: 'a.png', rawHref: '/x?raw' }, { kind: 'image' }).startsWith('<!doctype html>')).toBe(true);
  });

  it('gives the landing page a manifest and an artifact page none', () => {
    expect(homeShell()).toContain('rel="manifest"');
    expect(fileShell({ path: 'a.png', rawHref: '/x?raw' }, { kind: 'image' })).not.toContain('rel="manifest"');
  });

  it('presses the chip the stored expiry already is', () => {
    const forever = adminShell({
      meta: meta(['a.txt']),
      origin: 'https://share.test',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    expect(forever).toContain('data-ttl="forever" aria-pressed="true"');
    expect(forever).toContain('data-ttl="7d" aria-pressed="false"');
  });
});

/* The index page is what a recipient lands on, and it has to name the export
   beside the file: a bare `.md` sniffs deck-or-document from its own content,
   which they cannot guess, and the `.pdf` is the thing they attach. */
describe('the index listing offers each source its spellings', () => {
  it('names the pdf beside a markdown file, relative so nothing hardcodes an origin', () => {
    const paths = ['deck.md', 'chart.png'];
    const out = indexShell(index(paths), meta(paths));
    expect(out).toContain('href="deck.pdf"');
    expect(out).not.toContain('href="/deck.pdf"');
    // A png exports nothing, so it gets its name and no spellings.
    expect(out).toContain('href="chart.png"');
    expect(out).not.toContain('href="chart.pdf"');
  });

  it('gives a file that exports nothing no spelling row at all', () => {
    const out = indexShell(index(['notes.zip']), meta(['notes.zip']));
    expect(out).not.toContain('spellings');
  });

  it('leads a generation with its bare name and keeps the stamp linked', () => {
    const out = indexShell(index([], ['deck.1712.md']), meta(['deck.1712.md']));
    expect(out).toContain('deck.md (newest)');
    expect(out).toContain('href="deck.1712.md"');
    expect(out).toContain('href="deck.1712.pdf"');
  });
});
