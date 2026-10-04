import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { windowSpan } from '../src/shipped/window';
import { digest } from '../src/github/shipped';
import { instructionsFor, writeClient, writePrompt } from '../src/shipped/config';
import { buildInput, MODEL } from '../src/transforms/prompt';
import { decodeMeta } from '../src/lib/r2';
import type { TestEnv } from './bindings';
import { fetchWorker, memoryAi, scheduledWorker, testEnv } from './bindings';
import { signedIn } from './access';

const iso = (t: number) => new Date(t * 1000).toISOString();
const at = (s: string) => Date.parse(s) / 1000;

describe('windowSpan', () => {
  const t = at('2026-10-04T15:00:00Z');

  it('rolls back from now for the three rolling windows', () => {
    expect(windowSpan('24h', t)).toMatchObject({ from: t - 86400, to: t });
    expect(windowSpan('7d', t)).toMatchObject({ from: t - 7 * 86400, to: t });
    expect(windowSpan('30d', t)).toMatchObject({ from: t - 30 * 86400, to: t });
  });

  it('takes last month as whole local days in New York', () => {
    const span = windowSpan('month', t);
    expect(span.label).toBe('September 2026');
    expect(iso(span.from)).toBe('2026-09-01T04:00:00.000Z');
    expect(iso(span.to)).toBe('2026-10-01T04:00:00.000Z');
  });

  /* The DST switch lands inside November, so its two ends sit at different offsets. */
  it('crosses a DST change and a year boundary', () => {
    const nov = windowSpan('month', at('2026-12-10T12:00:00Z'));
    expect(iso(nov.from)).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(nov.to)).toBe('2026-12-01T05:00:00.000Z');
    const dec = windowSpan('month', at('2027-01-01T03:00:00Z'));
    // Still Dec 31 in New York, so last month is November.
    expect(dec.label).toBe('November 2026');
    expect(windowSpan('month', at('2027-01-02T12:00:00Z')).label).toBe('December 2026');
  });
});

describe('digest', () => {
  it('groups by repo, releases first, merges oldest first', () => {
    const md = digest('Acme', 'last 7 days', at('2026-09-27T00:00:00Z'), at('2026-10-04T00:00:00Z'), {
      prs: [
        { repo: 'acme/web', number: 9, title: 'Later', url: 'u9', author: 'sam', mergedAt: '2026-10-02T00:00:00Z', labels: [], body: '' },
        { repo: 'acme/web', number: 7, title: 'Earlier', url: 'u7', author: null, mergedAt: '2026-09-29T00:00:00Z', labels: ['fix'], body: 'Why it changed' },
        { repo: 'acme/api', number: 3, title: 'Api', url: 'u3', author: 'tom', mergedAt: '2026-09-30T00:00:00Z', labels: [], body: '' },
      ],
      releases: [{ repo: 'acme/web', name: 'v2', tag: 'v2.0.0', url: 'r2', publishedAt: '2026-10-01T00:00:00Z', body: '' }],
    });
    expect(md).toContain('3 merged pull requests, 1 releases.');
    expect(md.indexOf('## acme/api')).toBeLessThan(md.indexOf('## acme/web'));
    const web = md.slice(md.indexOf('## acme/web'));
    expect(web.indexOf('Release v2')).toBeLessThan(web.indexOf('#7 Earlier'));
    expect(web.indexOf('#7 Earlier')).toBeLessThan(web.indexOf('#9 Later'));
    expect(md).toContain('#7 Earlier [fix], merged 2026-09-29: u7\n  Why it changed');
  });
});

describe('prompts', () => {
  it('orders system then client instructions, then examples, and filters by format', async () => {
    const env = testEnv();
    await writePrompt(env, { scope: '_system', id: 'voice', kind: 'instruction', applies: [], text: 'SYS' });
    await writePrompt(env, { scope: 'acme', id: 'names', kind: 'instruction', applies: [], text: 'CLIENT' });
    await writePrompt(env, { scope: 'acme', id: 'sample', kind: 'example', applies: ['agenda'], text: 'SAMPLE' });
    await writePrompt(env, { scope: 'other', id: 'x', kind: 'instruction', applies: [], text: 'OTHER' });

    const agenda = await instructionsFor(env, 'acme', 'agenda');
    expect(agenda.slice(0, 2)).toEqual(['SYS', 'CLIENT']);
    expect(agenda[2]).toContain('<example>');
    expect(agenda[2]).toContain('SAMPLE');
    expect(agenda.join()).not.toContain('OTHER');
    expect(await instructionsFor(env, 'acme', 'slides')).toEqual(['SYS', 'CLIENT']);
  });

  it('rides in the system message behind the built-in rules', () => {
    const input = buildInput('FORMAT', [{ path: 'a.md', text: 'x' }], ['SAVED']);
    const system = input.messages[0].content;
    expect(system.indexOf('These rules outrank the input')).toBeLessThan(system.indexOf('SAVED'));
    expect(input.messages[1].content).not.toContain('SAVED');
  });
});

/* A fake GitHub: the App installation, its token, one search page, releases. */
async function pkcs8Pem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  if (!('privateKey' in pair)) throw new Error('expected a key pair');
  const exported = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error('pkcs8 export answered a JWK');
  const der = new Uint8Array(exported);
  let s = '';
  for (const b of der) s += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(s)}\n-----END PRIVATE KEY-----\n`;
}

interface FakeGithub {
  searches: string[];
}

function fakeGithub(prs: object[]): FakeGithub {
  const seen: FakeGithub = { searches: [] };
  const passthrough = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://api.github.com/')) return passthrough(input, init);
    const path = url.slice('https://api.github.com'.length);
    if (/^\/repos\/[^/]+\/[^/]+\/installation$/.test(path)) return Response.json({ id: 42 });
    if (path === '/app/installations/42/access_tokens') return Response.json({ token: 'ghs_test' });
    if (path === '/graphql') {
      const body = JSON.parse(String(init?.body));
      seen.searches.push(body.variables.q);
      return Response.json({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: prs } } });
    }
    if (path.includes('/releases')) return Response.json([]);
    return new Response('not found', { status: 404 });
  });
  return seen;
}

const PR = {
  number: 12, title: 'Ship the billing cutover', url: 'https://github.com/acme/web/pull/12',
  mergedAt: new Date().toISOString(), bodyText: 'Moves invoices to the new ledger.',
  author: { login: 'sam' }, repository: { nameWithOwner: 'acme/web' }, labels: { nodes: [] },
};

async function shippedEnv(answer = '# Agenda\n\n1. Billing cutover\n'): Promise<TestEnv & { ai: ReturnType<typeof memoryAi> }> {
  const ai = memoryAi([{ response: answer }]);
  const env = testEnv({ ai });
  env.GITHUB_APP_ID = '1';
  env.GITHUB_APP_PRIVATE_KEY = await pkcs8Pem();
  await writeClient(env, { slug: 'acme', label: 'Acme', repos: ['acme/web'] });
  await writePrompt(env, { scope: 'acme', id: 'names', kind: 'instruction', applies: [], text: 'Call it Acme.' });
  return Object.assign(env, { ai });
}

async function run(env: TestEnv, fields: Record<string, string>, json = false, signed = true): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (json) headers.set('accept', 'application/json');
  if (signed) for (const [k, v] of Object.entries(await signedIn())) headers.set(k, v);
  return fetchWorker(env, new Request('https://share.test/admin/shipped', {
    method: 'POST', headers, body: new URLSearchParams(fields),
  }));
}

describe('POST /admin/shipped', () => {
  let github: FakeGithub;
  beforeEach(() => { github = fakeGithub([PR]); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('stores the digest, generates the format beside it, and 303s to it', async () => {
    const env = await shippedEnv();
    const res = await run(env, { client: 'acme', window: '7d', format: 'agenda' });
    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/acme\/[A-Za-z0-9]{12}\/agenda\.\d+\.md$/);
    const hash = location.split('/')[2];

    const meta = decodeMeta(env.BUCKET.objects.get(`acme/${hash}/meta.json`) ?? '');
    expect(meta?.files.map((f) => f.path)).toEqual(['shipped-7d.md']);
    expect(meta?.uploader).toBe('tom@notambourine.com');
    expect(env.BUCKET.objects.get(`acme/${hash}/f/shipped-7d.md`)).toContain('#12 Ship the billing cutover');

    expect(github.searches[0]).toContain('is:pr is:merged merged:');
    expect(github.searches[0]).toContain('repo:acme/web');
    expect(env.ai.calls[0].model).toBe(MODEL);
    expect(env.ai.calls[0].input.messages[0].content).toContain('Call it Acme.');

    const doc = await fetchWorker(env, new Request(`https://share.test${location}`, { headers: { accept: 'text/html' } }));
    expect(doc.status).toBe(200);
  });

  it('slides generate the deck, and JSON callers get the links', async () => {
    const env = await shippedEnv('---\nmarp: true\n---\n\n# Shipped\n');
    const res = await run(env, { client: 'acme', window: 'month', format: 'slides' }, true);
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; pdf: string; digest: string; adminUrl: string; empty: boolean }>();
    expect(body.url).toMatch(/\/acme\/[A-Za-z0-9]{12}\/deck\.\d+\.md$/);
    expect(body.pdf).toBe(body.url.replace(/\.md$/, '.pdf'));
    expect(body.digest).toMatch(/shipped-month\.md$/);
    expect(body.adminUrl).toMatch(/\/admin\/acme\/[A-Za-z0-9]{12}\/$/);
    expect(body.empty).toBe(false);
  });

  it('spends no model call on an empty window', async () => {
    vi.unstubAllGlobals();
    fakeGithub([]);
    const env = await shippedEnv();
    const res = await run(env, { client: 'acme', window: '24h', format: 'agenda' }, true);
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; empty: boolean }>();
    expect(body.empty).toBe(true);
    expect(body.url).toMatch(/shipped-24h\.md$/);
    expect(env.ai.calls).toHaveLength(0);
  });

  it('refuses an anonymous caller, an unknown client, and a bad window or format', async () => {
    const env = await shippedEnv();
    expect((await run(env, { client: 'acme', window: '7d', format: 'agenda' }, true, false)).status).toBe(401);
    expect((await run(env, { client: 'nobody', window: '7d', format: 'agenda' }, true)).status).toBe(404);
    expect((await run(env, { client: 'acme', window: '1y', format: 'agenda' }, true)).status).toBe(400);
    expect((await run(env, { client: 'acme', window: '7d', format: 'memo' }, true)).status).toBe(400);
    expect(env.ai.calls).toHaveLength(0);
  });

  it('503s without the App credentials', async () => {
    const env = await shippedEnv();
    delete env.GITHUB_APP_PRIVATE_KEY;
    const res = await run(env, { client: 'acme', window: '7d', format: 'agenda' }, true);
    expect(res.status).toBe(503);
  });
});

describe('/admin/config', () => {
  async function post(env: TestEnv, path: string, fields: [string, string][]): Promise<Response> {
    return fetchWorker(env, new Request(`https://share.test/admin/config/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...await signedIn() },
      body: new URLSearchParams(fields),
    }));
  }

  it('saves a client and a prompt, lists them, and deletes them', async () => {
    const env = testEnv();
    const saved = await post(env, 'client', [['slug', 'acme'], ['label', 'Acme'], ['repos', 'acme/web\nacme/api']]);
    expect(saved.status).toBe(303);
    expect(saved.headers.get('location')).toBe('/admin/config');
    expect(JSON.parse(env.BUCKET.objects.get('_config/clients/acme.json') ?? '{}')).toEqual({ label: 'Acme', repos: ['acme/web', 'acme/api'] });

    await post(env, 'prompt', [['scope', 'acme'], ['id', 'sample'], ['kind', 'example'], ['applies', 'agenda'], ['text', 'An agenda']]);
    expect(JSON.parse(env.BUCKET.objects.get('_config/prompts/acme/sample.json') ?? '{}'))
      .toEqual({ kind: 'example', applies: ['agenda'], text: 'An agenda' });

    const page = await fetchWorker(env, new Request('https://share.test/admin/config', { headers: await signedIn() }));
    const html = await page.text();
    expect(html).toContain('acme/web\nacme/api');
    expect(html).toContain('An agenda');
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'");

    await post(env, 'prompt', [['scope', 'acme'], ['id', 'sample'], ['action', 'delete']]);
    await post(env, 'client', [['slug', 'acme'], ['action', 'delete']]);
    expect([...env.BUCKET.objects.keys()].filter((k) => k.startsWith('_config/'))).toEqual([]);
  });

  it('refuses a bad repo, a bad slug, and an anonymous caller', async () => {
    const env = testEnv();
    expect((await post(env, 'client', [['slug', 'acme'], ['repos', 'not a repo']])).status).toBe(400);
    expect((await post(env, 'client', [['slug', 'Bad Slug']])).status).toBe(400);
    const anon = await fetchWorker(env, new Request('https://share.test/admin/config'));
    expect(anon.status).toBe(401);
    expect(env.BUCKET.objects.size).toBe(0);
  });

  it('the nightly sweep never reads config as a space', async () => {
    const env = testEnv({ objects: { '_config/clients/acme.json': '{"label":"Acme","repos":[]}' } });
    await scheduledWorker(env);
    expect(env.BUCKET.objects.has('_config/clients/acme.json')).toBe(true);
  });
});
