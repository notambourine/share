import type { Env } from './lib/types';
import { isValidSpace, isValidHash } from './lib/keys';
import { htmlResponse, textResponse, ROBOTS } from './lib/http';
import { errorShell } from './render/shell';
import { serve } from './routes/serve';
import { upload } from './routes/upload';
import { mint } from './routes/mint';
import { listSpace } from './routes/list';
import { del } from './routes/del';
import { short } from './routes/short';
import { sweep } from './sweep';

const STATIC = new Set([
  '/', '/index.html', '/robots.txt', '/llms.txt', '/SKILL.md',
  '/tokens.css', '/shell.css', '/render.js', '/favicon.svg', '/favicon.ico',
]);

/* A space slug can never collide with these: isValidSpace rejects a leading
   slash, so a prefix match here cannot shadow a real upload path. */
const STATIC_PREFIXES = ['/vendor/', '/fonts/'];

export function isStatic(path: string): boolean {
  return STATIC.has(path) || STATIC_PREFIXES.some((p) => path.startsWith(p));
}

export async function staticAsset(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', ROBOTS);
  out.headers.set('cache-control', 'public, max-age=3600');
  return out;
}

function notFound(): Response {
  return htmlResponse(errorShell(404), 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (isStatic(path)) {
      return staticAsset(request, env);
    }

    let segs: string[];
    try {
      segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return notFound();
    }

    if (segs[0] === 'up') {
      if (request.method !== 'POST') return textResponse('POST only\n', 405);
      if (segs.length !== 2) return textResponse('POST /up/<space>\n', 404);
      return upload(request, env, segs[1]);
    }

    if (segs[0] === 'sign' && segs.length === 1) {
      if (request.method !== 'POST') return textResponse('POST only\n', 405);
      return mint(request, env);
    }

    if (segs[0] === 'z' && segs.length === 2 && request.method === 'GET') {
      return short(env, segs[1]);
    }

    const space = segs[0];
    if (!space || !isValidSpace(space)) return notFound();

    if (segs.length === 1) {
      if (request.method !== 'GET') return textResponse('GET only\n', 405);
      return listSpace(request, env, space);
    }

    const hash = segs[1];
    if (!isValidHash(hash)) return notFound();

    if (request.method === 'DELETE') {
      if (segs.length !== 2) return textResponse('DELETE /<space>/<hash>/\n', 400);
      return del(request, env, space, hash);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse('GET only\n', 405);
    }

    let token: string | null = null;
    let restSegs: string[];
    if (segs[2] === 'k' && segs.length >= 4) {
      token = segs[3];
      restSegs = segs.slice(4);
    } else {
      restSegs = segs.slice(2);
    }

    // Relative assets need a base URL that ends in a slash; nudge bare prefixes.
    if (restSegs.length === 0 && !path.endsWith('/')) {
      return Response.redirect(`${url.origin}${path}/${url.search}`, 302);
    }

    const rest = restSegs.join('/');
    return serve(request, env, ctx, space, hash, token, rest);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sweep(env).then(({ scanned, trashed }) => {
      console.log(`sweep: scanned=${scanned} trashed=${trashed}`);
    }));
  },
} satisfies ExportedHandler<Env>;
