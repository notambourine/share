/**
 * Binary exports: cache lookup, render, serve.
 *
 * Only PDF lives here. A page's markup comes from src/render/markdown.ts on the
 * request that asks for it, so there is nothing to warm, nothing to invalidate
 * when the brand moves, and the browser binding is spent only on the one format
 * that genuinely needs a print engine.
 *
 * Derived artifacts cache under `<space>/<hash>/d/v<N>/`, keyed by the source's
 * full name - a generation's stamp included - so each version's render is its
 * own object. Delete and the nightly sweep list the whole `<space>/<hash>/`
 * prefix, so they trash and purge with their upload and need nothing here.
 */

import type { Env } from '../lib/types';
import {
  type ExportFormat, type RenderMode,
  derivedKey, checkKey, attemptKey, sniffDeck,
} from '../lib/exportPath';
import { now } from '../lib/clock';
import { render, type Artifacts } from '../lib/pdf';
import { printHtml, pdfOptionsFor } from '../render/export';
import { rawBytes } from '../lib/bytes';
import { readPayload } from '../lib/r2';
import { errorShell } from '../render/shell';
import { htmlResponse, ROBOTS } from '../lib/http';

export interface ExportTarget {
  space: string;
  hash: string;
  /** The source file the suffix hangs off. */
  source: string;
  format: ExportFormat;
  /** The requested URL, so the directory rides along. */
  url: URL;
  size: number;
}

function baseName(source: string): string {
  const name = source.slice(source.lastIndexOf('/') + 1);
  return name.replace(/\.(md|markdown)$/i, '') || name;
}

function downloadName(source: string, ext: ExportFormat): string {
  return `${baseName(source)}.${ext}`;
}

async function store(
  env: Env, space: string, hash: string, source: string, mode: RenderMode, out: Artifacts,
): Promise<void> {
  await Promise.all([
    env.BUCKET.put(derivedKey(space, hash, source, mode, 'pdf'), out.pdf, {
      httpMetadata: { contentType: 'application/pdf' },
    }),
    ...(out.check ? [env.BUCKET.put(checkKey(space, hash, source), JSON.stringify(out.check), {
      httpMetadata: { contentType: 'application/json' },
    })] : []),
  ]);
}

/** Null means the browser was unreachable and the caller answers a 202. */
async function produce(
  env: Env, browser: Fetcher, space: string, hash: string, source: string, mode: RenderMode, markdown: string, url: URL,
): Promise<Artifacts | null> {
  const title = baseName(source);
  const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  let html: string;
  try {
    html = await printHtml(env, {
      origin: url.origin,
      baseHref: `${url.origin}${dir}`,
      title,
      markdown,
      mode,
    });
  } catch (err) {
    console.log(`export: print HTML failed: ${err}`);
    return null;
  }
  const out = await render(browser, html, pdfOptionsFor(mode, title), mode === 'slides');
  if (out) await store(env, space, hash, source, mode, out);
  return out;
}

/** One browser per source per minute. The hash is the only credential a reader
    holds, so this is what bounds the BROWSER bill on a link that got around: a
    burst of first GETs, or a page that never goes idle, spends one render per
    window instead of one per request. Written before the render, so the window
    opens whether or not the render lands. */
export const ATTEMPT_SECS = 60;

/** True when this request may spend the browser; false inside another's window. */
async function claimRender(env: Env, space: string, hash: string, source: string, mode: RenderMode): Promise<boolean> {
  const key = attemptKey(space, hash, source, mode);
  const t = now();
  const last = Number(await (await env.BUCKET.get(key))?.text());
  if (Number.isFinite(last) && t - last < ATTEMPT_SECS) return false;
  await env.BUCKET.put(key, String(t), { httpMetadata: { contentType: 'text/plain' } });
  return true;
}

/** A `.pdf` URL must never answer HTML at 200 - a curl -o would
    write HTML into the file - so a missed render is a 202 and a retry. */
function rendering202(): Response {
  return new Response('Rendering. Retry in a few seconds.\n', {
    status: 202,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': '5',
      'cache-control': 'no-store',
      'x-robots-tag': ROBOTS,
    },
  });
}

export async function exportArtifact(
  request: Request, env: Env, target: ExportTarget,
): Promise<Response> {
  const { space, hash, source, url } = target;

  /* Deck or document from the content, every time. The bytes have to be read
     before the cache can be checked, because the sniff is what says which key
     this render lands under. */
  const markdown = await readPayload(env, space, hash, source);
  if (markdown === null) return htmlResponse(errorShell(404), 404);
  const mode = sniffDeck(markdown) ? 'slides' : 'doc';

  const key = derivedKey(space, hash, source, mode, 'pdf');
  const name = downloadName(source, 'pdf');
  if (await env.BUCKET.head(key)) return rawBytes(request, env, key, name, false);

  if (!env.BROWSER) {
    console.log('export: no BROWSER binding');
    return rendering202();
  }
  if (!await claimRender(env, space, hash, source, mode)) return rendering202();
  const out = await produce(env, env.BROWSER, space, hash, source, mode, markdown, url);
  if (!out) return rendering202();

  return rawBytes(request, env, key, name, false);
}
