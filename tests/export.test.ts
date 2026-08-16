import { describe, expect, it } from 'vitest';
import type { Env, Meta, MetaFile } from '../src/lib/types';
import { serve } from '../src/routes/serve';
import { derivedKey } from '../src/lib/exportPath';

const SPACE = 'acme';
const HASH = 'Xk92mQ7bTp01';
const DECK = '# One\n\ntext\n\n---\n\n# Two\n';

const enc = new TextEncoder();

/** Enough R2 for the serve path: meta read, cache probe, byte serve. */
function stubEnv(objects: Record<string, string>): Env {
  const at = (key: string) => {
    const v = objects[key];
    if (v === undefined) return null;
    const bytes = enc.encode(v);
    return {
      body: new Response(bytes).body,
      httpEtag: `"${bytes.byteLength}"`,
      size: bytes.byteLength,
      text: async () => v,
      json: async () => JSON.parse(v),
    };
  };
  return {
    BUCKET: {
      get: async (key: string) => at(key),
      head: async (key: string) => at(key),
      put: async (key: string, value: unknown) => { objects[key] = String(value); },
    },
    ASSETS: { fetch: async () => new Response('') },
    TOKENS: '{}',
    SIGNING_KEYS: '{}',
  } as unknown as Env;
}

const CTX = { waitUntil: () => { /* nothing to await in a test */ }, passThroughOnException: () => {} } as unknown as ExecutionContext;

function metaFor(files: MetaFile[]): string {
  const meta: Meta = {
    space: SPACE, hash: HASH, tier: 'open', uploader: 'test',
    createdAt: 0, expiresAt: null, idleTtl: null, lastAccess: 0, files,
  };
  return JSON.stringify(meta);
}

const MD_FILE: MetaFile = { path: 'deck.md', size: DECK.length, type: 'text/markdown; charset=utf-8' };

function world(extra: Record<string, string> = {}, files: MetaFile[] = [MD_FILE]) {
  return stubEnv({
    [`${SPACE}/${HASH}/meta.json`]: metaFor(files),
    [`${SPACE}/${HASH}/f/deck.md`]: DECK,
    ...extra,
  });
}

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

function get(path: string, accept = BROWSER): Request {
  return new Request(`https://share.test/${SPACE}/${HASH}/${path}`, { headers: { accept } });
}

const ask = (env: Env, path: string, accept?: string) =>
  serve(get(path, accept), env, CTX, SPACE, HASH, null, path);

describe('format suffixes', () => {
  it('serves a cached PDF, and the suffix outranks Accept', async () => {
    const key = derivedKey(SPACE, HASH, 'deck.md', 'slides', 'pdf');
    const env = world({ [key]: 'PDFBYTES' });
    const res = await ask(env, 'deck.md.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('PDFBYTES');
  });

  it('sniffs deck content to the slides shape on a bare .pdf', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'doc', 'pdf')]: 'DOC' });
    // Only the doc-shaped object exists, and the sniff wants the slides one.
    const res = await ask(env, 'deck.md.pdf');
    expect(res.headers.get('content-type')).not.toBe('application/pdf');
  });

  it('an explicit spelling beats the sniff', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'doc', 'pdf')]: 'DOC' });
    const res = await ask(env, 'deck.md.doc.pdf');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('DOC');
  });

  it('the snapshot carries its own CSP, so data: fonts load', async () => {
    const env = world({ [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'html')]: '<!doctype html>' });
    const res = await ask(env, 'deck.md.html');
    expect(res.headers.get('content-security-policy')).toContain('font-src data:');
  });

  it('.slides.html is the live deck: no cache, no browser', async () => {
    const env = world();
    const res = await ask(env, 'deck.md.slides.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('data-kind="slides"');
    expect(body).toContain('deck.md?raw');
  });

  /* A missing PDF is a worse day than a broken one: with no browser binding
     the request has to land on something a person can read. */
  it('degrades to the live shell rather than 500 when no browser is reachable', async () => {
    const env = world();
    const res = await ask(env, 'deck.md.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('data-kind="slides"');
  });

  it('a real uploaded file wins its own name', async () => {
    const files = [MD_FILE, { path: 'deck.md.pdf', size: 6, type: 'application/pdf' }];
    const env = world({ [`${SPACE}/${HASH}/f/deck.md.pdf`]: 'REAL' }, files);
    const res = await ask(env, 'deck.md.pdf', '*/*');
    expect(await res.text()).toBe('REAL');
  });

  it('404s a suffix whose source was never uploaded', async () => {
    const env = world();
    expect((await ask(env, 'missing.md.pdf')).status).toBe(404);
    expect((await ask(env, 'deck.md.docx')).status).toBe(404);
  });
});
