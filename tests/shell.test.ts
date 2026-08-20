import { describe, expect, it } from 'vitest';
import { fileShell, dirShell, adminShell, errorShell, homeShell, type ShellView } from '../src/render/shell';
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
    tier: 'open',
    uploader: 'test',
    createdAt: 1_700_000_000,
    expiresAt: null,
    files: paths.map((path) => ({ path, size: 17, type: 'text/plain; charset=utf-8' })),
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

  it('escapes it in the directory listing', () => {
    const out = dirShell('LCLC7zhWhmP4', [{ path: HOSTILE_PATH, size: 17, type: 'text/plain; charset=utf-8' }]);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes it across the admin page, tiles and file list alike', () => {
    const out = adminShell({
      meta: meta([HOSTILE_PATH, 'deck.md']),
      origin: 'https://share.test',
      kSeg: '',
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
      kSeg: '',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    for (const attr of ['data-copylink', 'data-arm', 'data-fire', 'data-disarm', 'data-countdown', 'data-exp', 'data-ttl', 'data-copy-href']) {
      expect(admin).toContain(attr);
    }
    // The poll needs both halves on the same tile, and the value, not just the key.
    expect(admin).toContain('data-src="deck.md" data-await="slides.pdf"');
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
      kSeg: '',
      now: 1_700_000_000,
      adminExp: 1_700_000_300,
    });
    expect(forever).toContain('data-ttl="forever" aria-pressed="true"');
    expect(forever).toContain('data-ttl="7d" aria-pressed="false"');
  });
});

/* The artifact root is what a recipient lands on, and a bare `.md` sniffs
   deck-or-document from its own content - which they cannot guess. Naming every
   spelling beside the file is what lets them pick. */
describe('the directory listing offers each source its spellings', () => {
  it('lists every tiled format for a markdown file, relative so a /k/ segment rides along', () => {
    const out = dirShell('LCLC7zhWhmP4', [
      { path: 'deck.md', size: 20, type: 'text/markdown' },
      { path: 'chart.png', size: 9, type: 'image/png' },
    ]);
    for (const href of ['deck.slides.html', 'deck.doc.html', 'deck.slides.pdf', 'deck.doc.pdf', 'deck.txt']) {
      expect(out).toContain(`href="${href}"`);
    }
    // Relative, never absolute: an absolute href would drop a signed segment.
    expect(out).not.toContain('href="/deck.slides.html"');
    // A png exports nothing, so it gets its name and no spellings.
    expect(out).toContain('href="chart.png"');
  });

  it('gives a file that exports nothing no spelling row at all', () => {
    const out = dirShell('LCLC7zhWhmP4', [{ path: 'notes.zip', size: 4, type: 'application/zip' }]);
    expect(out).not.toContain('spellings');
  });
});
