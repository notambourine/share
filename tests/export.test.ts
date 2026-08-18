import { describe, expect, it } from 'vitest';
import type { Env, Meta, MetaFile } from '../src/lib/types';
import { derivedKey } from '../src/lib/exportPath';
import { fetchWorker, testEnv } from './bindings';

const SPACE = 'acme';
const HASH = 'Xk92mQ7bTp01';
const DECK = '# One\n\ntext\n\n---\n\n# Two\n';

function metaFor(files: MetaFile[]): string {
  const meta: Meta = {
    space: SPACE, hash: HASH, tier: 'open', uploader: 'test',
    createdAt: 0, expiresAt: null, idleTtl: null, lastAccess: 0, files,
  };
  return JSON.stringify(meta);
}

const MD_FILE: MetaFile = { path: 'deck.md', size: DECK.length, type: 'text/markdown; charset=utf-8' };

function world(extra: Record<string, string> = {}, files: MetaFile[] = [MD_FILE]): Env {
  return testEnv({
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: metaFor(files),
      [`${SPACE}/${HASH}/f/deck.md`]: DECK,
      ...extra,
    },
  });
}

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function get(path: string, accept = BROWSER): Request {
  return new Request(`https://share.test/${SPACE}/${HASH}/${path}`, { headers: { accept } });
}

/* Through the dispatcher, so the path the router parses and the path the
   assertions name are the same string travelling one way. */
const ask = (env: Env, path: string, accept?: string) => fetchWorker(env, get(path, accept));

describe('page exports (uploaded HTML)', () => {
  const PAGE: MetaFile = { path: 'page.html', size: 9, type: 'text/html; charset=utf-8' };
  const pageWorld = (extra: Record<string, string> = {}) =>
    world({ [`${SPACE}/${HASH}/f/page.html`]: '<p>hi</p>', ...extra }, [PAGE]);

  it('a cold .png or .pdf answers 202, never HTML at 200', async () => {
    const env = pageWorld();
    for (const path of ['page.png', 'page.pdf', 'page.browser.png']) {
      const res = await ask(env, path);
      expect(res.status).toBe(202);
      expect(res.headers.get('retry-after')).toBe('5');
    }
  });

  it('serves a cached shot; bare .png and .full.png share the object', async () => {
    const env = pageWorld({ [derivedKey(SPACE, HASH, 'page.html', 'page', 'full.png')]: 'PNGBYTES' });
    for (const path of ['page.png', 'page.full.png']) {
      const res = await ask(env, path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(await res.text()).toBe('PNGBYTES');
    }
  });

  it('a real uploaded page.pdf wins its own name', async () => {
    const env = world({
      [`${SPACE}/${HASH}/f/page.pdf`]: 'REALPDF',
    }, [PAGE, { path: 'page.pdf', size: 7, type: 'application/pdf' }]);
    expect(await (await ask(env, 'page.pdf', '*/*')).text()).toBe('REALPDF');
  });
});

/* The bare URL is the one nearly every recipient opens, and it used to arrive
   empty: a shell, a second request for `?raw`, then 169 KB of parser before any
   text painted. The mode came from the extension alone, so a Marp deck opened as
   a document no matter what it said. */
describe('the live markdown view', () => {
  it('arrives rendered, as a deck when the content says deck', async () => {
    const html = await (await ask(world(), 'deck.md')).text();
    expect(html).toContain('data-kind="slides"');
    expect(html).toContain('data-marpit-svg');
    // No parser, and no second round trip to fetch what it would parse.
    expect(html).not.toContain('marpit.js');
    expect(html).not.toContain('data-raw');
  });

  it('arrives as a document when the content is prose', async () => {
    const prose = '# Notes\n\nJust prose, no separators.\n';
    const env = world({ [`${SPACE}/${HASH}/f/notes.md`]: prose },
      [{ path: 'notes.md', size: prose.length, type: 'text/markdown; charset=utf-8' }]);
    const html = await (await ask(env, 'notes.md')).text();
    expect(html).toContain('data-kind="md"');
    expect(html).toContain('<h1>Notes</h1>');
  });

  it('highlights a code file in the Worker too', async () => {
    const src = 'const a = 1;\n';
    const env = world({ [`${SPACE}/${HASH}/f/app.ts`]: src },
      [{ path: 'app.ts', size: src.length, type: 'text/plain; charset=utf-8' }]);
    const html = await (await ask(env, 'app.ts')).text();
    expect(html).toContain('hljs-keyword');
    expect(html).not.toContain('highlight.min.js');
  });

  /* Rendering means reading the bytes, so a file too big to read in a browser
     gets the download card instead. `?raw` still hands over every byte. */
  it('offers a download rather than inlining a file over the cap', async () => {
    const env = world({ [`${SPACE}/${HASH}/f/huge.md`]: '# big\n' },
      [{ path: 'huge.md', size: 2 * 1024 * 1024, type: 'text/markdown; charset=utf-8' }]);
    const html = await (await ask(env, 'huge.md')).text();
    expect(html).toContain('data-kind="download"');
    expect(html).toContain('?raw');
  });
});

describe('format suffixes', () => {
  it('serves a cached PDF, and the suffix outranks Accept', async () => {
    const key = derivedKey(SPACE, HASH, 'deck.md', 'slides', 'pdf');
    const env = world({ [key]: 'PDFBYTES' });
    const res = await ask(env, 'deck.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('PDFBYTES');
  });

  it('sniffs deck content to the slides mode on a bare .pdf', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'doc', 'pdf')]: 'DOC' });
    // Only the doc object exists, and the sniff wants the slides one.
    const res = await ask(env, 'deck.pdf');
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });

  it('an explicit spelling beats the sniff', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'doc', 'pdf')]: 'DOC' });
    const res = await ask(env, 'deck.doc.pdf');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('DOC');
  });

  /* The `.html` spellings are mode overrides, not artifacts: they render on the
     request that asks and store nothing, so there is no browser budget to spend
     and no stored copy to go stale when the brand moves. */
  it('.slides.html renders live, with no stored object and no browser', async () => {
    const env = world();
    const res = await ask(env, 'deck.slides.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('data-marpit-svg');
    // Rendered here, so the page ships no parser and asks for no second round trip.
    expect(html).not.toContain('marpit.js');
    expect(html).not.toContain('?raw');
  });

  it('.doc.html pins the document mode over content that sniffs as a deck', async () => {
    const html = await (await ask(world(), 'deck.doc.html')).text();
    expect(html).toContain('data-kind="md"');
    expect(html).not.toContain('data-marpit-svg');
  });

  it('a bare .html sniffs the mode, the way a bare .pdf does', async () => {
    const html = await (await ask(world(), 'deck.html')).text();
    expect(html).toContain('data-kind="slides"');
  });

  it('.txt is the source bytes as text/plain, always', async () => {
    const env = world();
    const res = await ask(env, 'deck.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe(DECK);
  });

  /* A .pdf URL never answers HTML at 200: `curl -o deck.pdf` would write HTML
     into a .pdf and look like success. */
  it('a cold .pdf answers 202 + Retry-After, never HTML at 200', async () => {
    const env = world();
    const res = await ask(env, 'deck.pdf');
    expect(res.status).toBe(202);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.headers.get('content-type')).not.toContain('text/html');
  });

  /* For .html a live shell is still a page a person can read. */
  it('a cold .html degrades to the live shell', async () => {
    const env = world();
    const res = await ask(env, 'deck.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('data-kind="slides"');
  });

  it('a real uploaded file wins its own name', async () => {
    const files = [MD_FILE, { path: 'deck.pdf', size: 6, type: 'application/pdf' }];
    const env = world({ [`${SPACE}/${HASH}/f/deck.pdf`]: 'REAL' }, files);
    const res = await ask(env, 'deck.pdf', '*/*');
    expect(await res.text()).toBe('REAL');
  });

  it('404s a suffix whose source was never uploaded, the legacy spelling included', async () => {
    const env = world();
    expect((await ask(env, 'missing.pdf')).status).toBe(404);
    expect((await ask(env, 'deck.docx')).status).toBe(404);
    expect((await ask(env, 'deck.md.pdf')).status).toBe(404);
  });
});
