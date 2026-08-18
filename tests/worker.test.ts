/**
 * The dispatcher, through the front door.
 *
 * Precedence in src/worker.ts is the security model - an uploaded file named
 * `config`, `admin`, or `status` keeps its GET - and every test that called a
 * route function directly was reimplementing the router rather than holding it.
 */

import { describe, expect, it } from 'vitest';
import { ADMIN_SECS, mintAdminToken } from '../src/lib/admin';
import { mintToken } from '../src/lib/sign';
import { now } from '../src/lib/http';
import { DECK_THEME, TOKENS } from '../src/brand';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const NOW = now();

const FILES = [
  { path: 'status', size: 6, type: 'text/plain; charset=utf-8' },
  { path: 'note.md', size: 8, type: 'text/markdown; charset=utf-8' },
];

function seededEnv(tier: 'open' | 'signed' = 'open'): TestEnv {
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    /* A 404 from ASSETS, so a route that reaches the static server instead of
       the bundle is visible rather than merely different. */
    assets: { fetch: async () => new Response('missing\n', { status: 404 }) },
    objects: {
      [`${SPACE}/${HASH}/meta.json`]: JSON.stringify({
        space: SPACE, hash: HASH, tier, uploader: 'tom',
        createdAt: NOW, expiresAt: null, idleTtl: null, lastAccess: NOW, files: FILES,
      }),
      [`${SPACE}/${HASH}/f/status`]: 'uptime',
      [`${SPACE}/${HASH}/f/note.md`]: '# hello\n',
    },
  });
}

const at = (path: string, init?: RequestInit) =>
  new Request(`https://share.test${path}`, init);

describe('path decoding', () => {
  it('404s bad percent-encoding rather than throwing', async () => {
    const env = seededEnv();
    for (const path of [`/${SPACE}/${HASH}/%E0%A4%A`, '/%zz/a', `/${SPACE}/%C0%80/`]) {
      expect((await fetchWorker(env, at(path))).status).toBe(404);
    }
  });
});

describe('method gates', () => {
  it('names the verb each prefix takes', async () => {
    const env = seededEnv();
    const cases: [string, string, number][] = [
      ['/up/acme', 'GET', 405],
      ['/up', 'POST', 404],
      ['/up/acme/extra', 'POST', 404],
      ['/sign', 'GET', 405],
      ['/session', 'GET', 405],
      [`/${SPACE}/`, 'PUT', 405],
      [`/${SPACE}/${HASH}/note.md`, 'PUT', 405],
      [`/${SPACE}/${HASH}/config`, 'PUT', 405],
    ];
    for (const [path, method, status] of cases) {
      expect([path, (await fetchWorker(env, at(path, { method }))).status]).toEqual([path, status]);
    }
  });

  it('DELETE takes the artifact root and nothing under it', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, at(`/${SPACE}/${HASH}/note.md`, { method: 'DELETE' }))).status).toBe(400);
  });
});

/* The three names an upload may carry that the router also owns. Losing this
   would hand an uploader a path the dispatcher answers instead of their file. */
describe('an uploaded file keeps its GET', () => {
  it('`status` needs ?c= to reach the admin route, and serves bytes without it', async () => {
    const env = seededEnv();
    const bare = await fetchWorker(env, at(`/${SPACE}/${HASH}/status`, { headers: { accept: '*/*' } }));
    expect(bare.status).toBe(200);
    expect(await bare.text()).toBe('uptime');

    const c = await mintAdminToken(KEYS, SPACE, HASH, NOW + ADMIN_SECS);
    const admin = await fetchWorker(env, at(`/${SPACE}/${HASH}/status?c=${c}`));
    expect(admin.headers.get('content-type')).toContain('application/json');
    expect(admin.status).toBe(200);
  });

  it('`config` and `admin` are POST-only, so a GET reaches the file', async () => {
    const env = seededEnv();
    for (const name of ['config', 'admin']) {
      // Not uploaded here, so serve's own 404 is the proof it got that far.
      const res = await fetchWorker(env, at(`/${SPACE}/${HASH}/${name}`));
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
  });
});

describe('the /k/ segment', () => {
  it('carries the view token off the URL, end to end', async () => {
    const env = seededEnv('signed');
    expect((await fetchWorker(env, at(`/${SPACE}/${HASH}/note.md`))).status).toBe(401);
    const token = await mintToken(KEYS, `${SPACE}/${HASH}`, NOW + 600);
    const ok = await fetchWorker(env, at(`/${SPACE}/${HASH}/k/${token}/note.md`));
    expect(ok.status).toBe(200);
  });

  /* The token is a path segment, so the hrefs a page prints have to carry it.
     They used to be re-derived from request.url with nothing checking. */
  it('rides into the links the page prints', async () => {
    const env = seededEnv('signed');
    const token = await mintToken(KEYS, `${SPACE}/${HASH}`, NOW + 600);
    const html = await (await fetchWorker(env, at(`/${SPACE}/${HASH}/k/${token}/note.md`, {
      headers: { accept: 'text/html' },
    }))).text();
    expect(html).toContain(
      `<meta property="og:url" content="https://share.test/${SPACE}/${HASH}/k/${token}/note.md"/>`,
    );
  });
});

describe('the trailing-slash nudge', () => {
  it('302s a bare artifact prefix, query intact, and leaves a file path alone', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, at(`/${SPACE}/${HASH}?c=x`));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://share.test/${SPACE}/${HASH}/?c=x`);
    expect((await fetchWorker(env, at(`/${SPACE}/${HASH}/note.md`))).status).toBe(200);
  });

  it('nudges the /k/ root too, so the token survives the redirect', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, at(`/${SPACE}/${HASH}/k/v1.0.abc`));
    expect(res.headers.get('location')).toBe(`https://share.test/${SPACE}/${HASH}/k/v1.0.abc/`);
  });
});

/* isStatic still says yes to /vendor/marp/nt-marp.css, so worker.ts asks
   brandSheet first. Swap the two lines and these fall to the ASSETS 404. */
describe('brandSheet outranks the static prefix', () => {
  it('serves both sheets from the bundle', async () => {
    const env = seededEnv();
    const tokens = await fetchWorker(env, at('/tokens.css'));
    expect(tokens.status).toBe(200);
    expect(await tokens.text()).toBe(TOKENS);

    const deck = await fetchWorker(env, at('/vendor/marp/nt-marp.css'));
    expect(deck.status).toBe(200);
    expect(await deck.text()).toBe(DECK_THEME);
  });

  it('still hands the rest of /vendor/ to ASSETS', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, at('/vendor/marp/marpit.js'))).status).toBe(404);
  });
});

describe('the roots the bundle owns', () => {
  it('answers / and /SKILL.md without touching ASSETS', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, at('/'))).status).toBe(200);
    expect((await fetchWorker(env, at('/index.html'))).status).toBe(200);
    const skill = await fetchWorker(env, at('/SKILL.md'));
    expect(skill.status).toBe(200);
    expect(await skill.text()).toContain('nt-share');
  });

  it('404s a space slug that is not one', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, at('/UPPER/'))).status).toBe(404);
    expect((await fetchWorker(env, at(`/${SPACE}/short/`))).status).toBe(404);
  });
});
