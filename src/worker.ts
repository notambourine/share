import type { Env } from './lib/types';
import { isValidSpace, isValidHash } from './lib/keys';
import { parseRoute, pathSegments } from './lib/route';
import { htmlResponse, textResponse, ROBOTS } from './lib/http';
import { errorShell, homeShell } from './render/shell';
import { serve } from './routes/serve';
import { upload } from './routes/upload';
import { del } from './routes/del';
import { adminConfig, adminRemint } from './routes/admin';
import { generate } from './routes/generate';
import { skillDoc } from './skill';
import { brandSheet } from './brand';
import { sweep } from './sweep';

/* Four paths are absent on purpose. /SKILL.md, /tokens.css, and
   /vendor/marp/nt-marp.css are served from the bundle by src/skill.ts and
   src/brand.ts, so no copy of the skill or the brand lives under public/. The
   landing page joins them because it wears the same header as every artifact
   shell, and that header inlines the lockup out of the bundle.
   shell.css, print.css, nt-code.css, and nt-table.css are this repo's own chrome
   and stay static. Every other file under public/ must be named here or by a prefix
   below - run_worker_first hands this router the whole origin, so a path it
   does not name 404s no matter what sits on disk. */
const STATIC = new Set([
  '/robots.txt', '/llms.txt',
  '/shell.css', '/print.css', '/nt-code.css', '/nt-table.css',
  '/render.js', '/admin.js', '/print.js', '/table.js',
]);

/* A space slug can never collide with these: isValidSpace rejects a leading
   slash, so a prefix match here cannot shadow a real upload path. */
const STATIC_PREFIXES = ['/vendor/', '/fonts/', '/logo/'];

/* A browser asks for these at the root whatever a page links, so they answer
   there too. Aliases, not copies: public/logo/ holds the only bytes. */
const ROOT_ICONS = new Map([
  ['/favicon.svg', '/logo/favicon.svg'],
  ['/favicon.ico', '/logo/export/favicon.ico'],
  ['/apple-touch-icon.png', '/logo/export/apple-touch-icon.png'],
  ['/apple-touch-icon-precomposed.png', '/logo/export/apple-touch-icon.png'],
]);

export function isStatic(path: string): boolean {
  return STATIC.has(path)
    || ROOT_ICONS.has(path)
    || STATIC_PREFIXES.some((p) => path.startsWith(p));
}

export async function staticAsset(request: Request, env: Env): Promise<Response> {
  const alias = ROOT_ICONS.get(new URL(request.url).pathname);
  const req = alias ? new Request(new URL(alias, request.url), request) : request;
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', ROBOTS);
  out.headers.set('cache-control', 'public, max-age=3600');
  return out;
}

function notFound(): Response {
  return htmlResponse(errorShell(404), 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/index.html') {
      return htmlResponse(homeShell());
    }

    if (path === '/SKILL.md') {
      return skillDoc();
    }

    /* Ahead of isStatic: /vendor/marp/nt-marp.css sits under a static prefix,
       and the bundle owns that URL now. */
    const sheet = brandSheet(path);
    if (sheet) return sheet;

    if (isStatic(path)) {
      return staticAsset(request, env);
    }

    const segs = pathSegments(path);
    if (!segs) return notFound();

    if (segs[0] === 'up') {
      if (request.method !== 'POST') return textResponse('POST only\n', 405);
      if (segs.length !== 2) return textResponse('POST /up/<space>\n', 404);
      return upload(request, env, segs[1]);
    }

    const space = segs[0];
    if (!space || !isValidSpace(space)) return notFound();

    /* A space slug alone names no page: every share is behind its hash, and
       answering here would confirm the space exists to whoever guessed it. */
    if (segs.length === 1) return notFound();

    const hash = segs[1];
    if (!isValidHash(hash)) return notFound();

    if (request.method === 'DELETE') {
      if (segs.length !== 2) return textResponse('DELETE /<space>/<hash>/\n', 400);
      return del(request, env, space, hash);
    }
    /* POST only, so an uploaded file named `config`, `admin`, or `generate`
       keeps its GET. */
    if (request.method === 'POST' && segs.length === 3) {
      if (segs[2] === 'config') return adminConfig(request, env, space, hash);
      if (segs[2] === 'admin') return adminRemint(request, env, space, hash);
      if (segs[2] === 'generate') return generate(request, env, space, hash);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('GET only\n', 405);
    }

    const route = parseRoute(url, segs);

    // Relative assets need a base URL that ends in a slash; nudge bare prefixes.
    if (route.rest === '' && !path.endsWith('/')) {
      return Response.redirect(`${url.origin}${path}/${url.search}`, 302);
    }

    return serve(request, env, route);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env).then(({ scanned, trashed }) => {
      console.log(`sweep: scanned=${scanned} trashed=${trashed}`);
    }));
  },
} satisfies ExportedHandler<Env>;
