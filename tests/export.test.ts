import { describe, expect, it } from 'vitest';
import type { Env, Meta, MetaFile } from '../src/lib/types';
import { serve } from '../src/routes/serve';
import { derivedKey } from '../src/lib/exportPath';
import { DEFERRED, testEnv } from './bindings';

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

const ask = (env: Env, path: string, accept?: string) =>
  serve(get(path, accept), env, DEFERRED, SPACE, HASH, null, path);

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

  it('the snapshot carries its own CSP, so data: fonts load', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'html')]: '<!doctype html>' });
    const res = await ask(env, 'deck.html');
    expect(res.headers.get('content-security-policy')).toContain('font-src data:');
  });

  it('.slides.html serves the cached snapshot, same as every other export', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'html')]: '<!doctype html>SNAP' });
    const res = await ask(env, 'deck.slides.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('SNAP');
    expect(res.headers.get('content-security-policy')).toContain('font-src data:');
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
