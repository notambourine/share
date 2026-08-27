/**
 * The public index: one URL, two representations, no credential. A browser gets
 * the page and an `Accept: application/json` request gets the same model, which
 * is what an external agent reads - and is why no route answers status any more.
 */

import { describe, expect, it } from 'vitest';
import type { MetaFile } from '../src/lib/types';
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

/* Only the upload is named in meta. The two versions are objects under `f/` and
   nothing else, because that is all the generate route writes - the index finds
   them by listing, the way it has always found renders. */
const FILES = [{ path: 'notes.txt', size: 40, type: 'text/plain; charset=utf-8' }];

const V1 = '# deck, first cut\n';
const V2 = '# deck, second cut\n';

const GENERATED = {
  [`${SPACE}/${HASH}/f/deck.1000.md`]: V1,
  [`${SPACE}/${HASH}/f/deck.2000.md`]: V2,
};

function seededEnv(
  extra: Record<string, string> = {},
  files: MetaFile[] = FILES,
  generated: Record<string, string> = GENERATED,
): TestEnv {
  return testEnv({
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: JSON.stringify({
        space: SPACE, hash: HASH, uploader: 'tom', createdAt: NOW, expiresAt: null, files,
      }),
      ...generated,
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
    expect(html).not.toContain('data-genform');
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
        { path: 'deck.2000.md', size: V2.length, stamp: 2000, exports: ['deck.2000.pdf'] },
        { path: 'deck.1000.md', size: V1.length, stamp: 1000, exports: ['deck.1000.pdf'] },
      ],
    }]);
  });

  /* A poster is never its own row in meta.files, so a listing that only excluded
     rows would report it as a generation of its own. */
  it('does not read a video poster as a generation', async () => {
    const env = seededEnv({
      [`${SPACE}/${HASH}/f/clip.mp4`]: 'MP4BYTES',
      [`${SPACE}/${HASH}/f/clip.poster.jpg`]: 'JPGBYTES',
    }, [
      { path: 'clip.mp4', size: 8, type: 'video/mp4', poster: 'clip.poster.jpg' },
    ], {});
    const body = await (await fetchWorker(env, root('application/json'))).json<IndexBody>();
    expect(body.generations).toEqual([]);
    expect(body.uploads.map((f) => f.path)).toEqual(['clip.mp4']);
  });

  /* An upload keeps its own name whatever it looks like: which side of the split
     a file lands on is settled by meta.files, never guessed off the filename. */
  it('reads an upload that looks stamped as a source, not as a version', async () => {
    const env = seededEnv({ [`${SPACE}/${HASH}/f/report.1712.md`]: '# report\n' }, [
      { path: 'report.1712.md', size: 9, type: 'text/markdown; charset=utf-8' },
    ], {});
    const body = await (await fetchWorker(env, root('application/json'))).json<IndexBody>();
    expect(body.uploads.map((f) => f.path)).toEqual(['report.1712.md']);
    expect(body.uploads[0].stamp).toBeNull();
    expect(body.generations).toEqual([]);
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
