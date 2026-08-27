/**
 * The public index: one URL, two representations, no credential. A browser gets
 * the page and an `Accept: application/json` request gets the same model, which
 * is what an external agent reads - and is why no route answers status any more.
 */

import { describe, expect, it } from 'vitest';
import { checkKey, derivedKey } from '../src/lib/exportPath';
import { now } from '../src/lib/clock';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const NOW = now();

interface IndexBody {
  space: string;
  hash: string;
  uploads: { path: string; stamp: number | null; exports: string[] }[];
  generations: { name: string; versions: { path: string; stamp: number | null }[] }[];
  renders: { source: string; path: string; key: string; check: { slides: number; overflow: number[] } | null }[];
}

const FILES = [
  { path: 'notes.txt', size: 40, type: 'text/plain; charset=utf-8' },
  { path: 'deck.1000.md', size: 30, type: 'text/markdown; charset=utf-8' },
  { path: 'deck.2000.md', size: 32, type: 'text/markdown; charset=utf-8' },
];

function seededEnv(extra: Record<string, string> = {}, files = FILES): TestEnv {
  return testEnv({
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: JSON.stringify({
        space: SPACE, hash: HASH, uploader: 'tom', createdAt: NOW, expiresAt: null, files,
      }),
      ...extra,
    },
  });
}

const root = (accept: string) =>
  new Request(`https://share.test/${SPACE}/${HASH}/`, { headers: { accept } });

describe('the index page', () => {
  it('serves HTML on Accept: text/html, with no credential', async () => {
    const res = await fetchWorker(seededEnv(), root('text/html'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    // The newest generation leads, older stamps stay linked, sources are named.
    expect(html).toContain('deck.md (newest)');
    expect(html).toContain('href="deck.2000.md"');
    expect(html).toContain('href="deck.1000.md"');
    expect(html).toContain('href="deck.2000.pdf"');
    expect(html).toContain('notes.txt');
    // No working-page chrome: this page writes nothing.
    expect(html).not.toContain('data-ttl');
    expect(html).not.toContain('data-generate');
  });

  it('serves the same model as JSON, also with no credential', async () => {
    const res = await fetchWorker(seededEnv(), root('application/json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json<IndexBody>();
    expect([body.space, body.hash]).toEqual([SPACE, HASH]);
    expect(body.uploads.map((f) => f.path)).toEqual(['notes.txt']);
    expect(body.generations).toEqual([{
      name: 'deck',
      versions: [
        { path: 'deck.2000.md', size: 32, stamp: 2000, exports: ['deck.2000.pdf'] },
        { path: 'deck.1000.md', size: 30, stamp: 1000, exports: ['deck.1000.pdf'] },
      ],
    }]);
  });

  it('lists a stored render and carries the overflow verdict', async () => {
    const env = seededEnv({
      [derivedKey(SPACE, HASH, 'deck.2000.md', 'slides', 'pdf')]: 'PDFBYTES',
      [checkKey(SPACE, HASH, 'deck.2000.md')]: '{"slides":12,"overflow":[7]}',
    });
    const body = await (await fetchWorker(env, root('application/json'))).json<IndexBody>();
    expect(body.renders).toEqual([{
      source: 'deck.2000.md',
      path: 'deck.2000.pdf',
      key: 'slides.pdf',
      check: { slides: 12, overflow: [7] },
    }]);

    const html = await (await fetchWorker(env, root('text/html'))).text();
    expect(html).toContain('slide 7 overflows');
  });

  it('answers an unmeasured render with a null verdict rather than failing', async () => {
    const env = seededEnv({
      [derivedKey(SPACE, HASH, 'deck.2000.md', 'doc', 'pdf')]: 'PDFBYTES',
      [checkKey(SPACE, HASH, 'deck.2000.md')]: '{"slides":"twelve"}',
    });
    const body = await (await fetchWorker(env, root('application/json'))).json<IndexBody>();
    expect(body.renders[0].check).toBeNull();
  });

  it('leaves an uploaded site to serve itself rather than an index', async () => {
    const env = seededEnv({ [`${SPACE}/${HASH}/f/index.html`]: '<p>hi</p>' }, [
      { path: 'index.html', size: 9, type: 'text/html; charset=utf-8' },
    ]);
    const res = await fetchWorker(env, root('text/html'));
    expect(await res.text()).toBe('<p>hi</p>');
  });

  it('404s a hash that is gone, whichever representation asked', async () => {
    const env = testEnv();
    for (const accept of ['text/html', 'application/json']) {
      expect((await fetchWorker(env, root(accept))).status).toBe(404);
    }
  });
});
