import { describe, expect, it } from 'vitest';
import type { Env, Meta, MetaFile } from '../src/lib/types';
import { derivedKey } from '../src/lib/exportPath';
import { fetchWorker, testEnv } from './bindings';

const SPACE = 'acme';
const HASH = 'Xk92mQ7bTp01';
const DECK = '# One\n\ntext\n\n---\n\n# Two\n';

function metaFor(files: MetaFile[]): string {
  const meta: Meta = {
    space: SPACE, hash: HASH, uploader: 'test',
    createdAt: 0, expiresAt: null, files,
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
    for (const path of ['page.png', 'page.pdf']) {
      const res = await ask(env, path);
      expect(res.status).toBe(202);
      expect(res.headers.get('retry-after')).toBe('5');
    }
  });

  it('serves a cached shot', async () => {
    const env = pageWorld({ [derivedKey(SPACE, HASH, 'page.html', 'page', 'png')]: 'PNGBYTES' });
    const res = await ask(env, 'page.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGBYTES');
  });

  /* The spelled-out alias is gone with the rest of the grammar: one name per
     artifact, and the page generates the link. */
  it('404s the old .full.png spelling', async () => {
    expect((await ask(pageWorld(), 'page.full.png')).status).toBe(404);
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

describe('the .pdf suffix', () => {
  it('serves a cached PDF, and the suffix outranks Accept', async () => {
    const key = derivedKey(SPACE, HASH, 'deck.md', 'slides', 'pdf');
    const env = world({ [key]: 'PDFBYTES' });
    const res = await ask(env, 'deck.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('PDFBYTES');
  });

  /* Deck-or-document is the content's call, every time: the cache key follows
     the sniff, so a doc render is not what a deck URL hands back. */
  it('sniffs deck content to the slides key', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'doc', 'pdf')]: 'DOC' });
    const res = await ask(env, 'deck.pdf');
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });

  it('sniffs prose to the doc key', async () => {
    const prose = '# Notes\n\nJust prose.\n';
    const env = world({
      [`${SPACE}/${HASH}/f/notes.md`]: prose,
      [derivedKey(SPACE, HASH, 'notes.md', 'doc', 'pdf')]: 'DOC',
    }, [{ path: 'notes.md', size: prose.length, type: 'text/markdown; charset=utf-8' }]);
    expect(await (await ask(env, 'notes.pdf', '*/*')).text()).toBe('DOC');
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

  it('a real uploaded file wins its own name', async () => {
    const files = [MD_FILE, { path: 'deck.pdf', size: 6, type: 'application/pdf' }];
    const env = world({ [`${SPACE}/${HASH}/f/deck.pdf`]: 'REAL' }, files);
    const res = await ask(env, 'deck.pdf', '*/*');
    expect(await res.text()).toBe('REAL');
  });

  it('404s a suffix whose source was never uploaded, the retired spellings included', async () => {
    const env = world();
    for (const path of ['missing.pdf', 'deck.docx', 'deck.md.pdf', 'deck.txt', 'deck.slides.pdf', 'deck.html']) {
      expect([path, (await ask(env, path)).status]).toEqual([path, 404]);
    }
  });
});
