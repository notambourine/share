/**
 * Binary exports: cache lookup, render, serve.
 *
 * Only PDF and PNG live here. HTML used to as well - a stored snapshot that a
 * headless Chrome produced from the same markdown the shell was parsing in the
 * reader's browser - and deleting that is what this module is now. A page's
 * markup comes from src/render/markdown.ts on the request that asks for it, so
 * there is nothing to warm, nothing to invalidate when the brand moves, and the
 * browser binding is spent only on the two formats that genuinely need a print
 * engine.
 *
 * Derived artifacts cache under `<space>/<hash>/d/v<N>/`, keyed by the source's
 * full name - a generation's stamp included - so each version's render is its
 * own object. Delete and the nightly sweep list the whole `<space>/<hash>/`
 * prefix, so they trash and purge with their upload and need nothing here.
 */

import type { Env } from '../lib/types';
import {
  type ExportFormat, type RenderMode,
  derivedKey, checkKey, sniffDeck, isPageSource,
} from '../lib/exportPath';
import { render, renderPage, type Artifacts, type PageArtifacts } from '../lib/pdf';
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
  return name.replace(/\.(md|markdown|html?)$/i, '') || name;
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
  env: Env, space: string, hash: string, source: string, mode: RenderMode, markdown: string, url: URL,
): Promise<Artifacts | null> {
  if (!env.BROWSER) {
    console.log('export: no BROWSER binding');
    return null;
  }
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
  const out = await render(env.BROWSER, html, pdfOptionsFor(mode, title), mode === 'slides');
  if (out) await store(env, space, hash, source, mode, out);
  return out;
}

/** A `.pdf` or `.png` URL must never answer HTML at 200 - a curl -o would
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

/** The first GET pays the render. One load stores both outputs, so the other
    spelling is ready on the same click. */
async function exportPage(request: Request, env: Env, target: ExportTarget): Promise<Response> {
  const { space, hash, source, format, url } = target;
  const key = derivedKey(space, hash, source, 'page', format);
  const name = downloadName(source, format);
  if (await env.BUCKET.head(key)) return rawBytes(request, env, key, name, false);

  if (!env.BROWSER) {
    console.log('export: no BROWSER binding');
    return rendering202();
  }
  const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  const out = await renderPage(env.BROWSER, `${url.origin}${dir}${encodeURI(source)}`, pdfOptionsFor('page', baseName(source)));
  if (!out) {
    console.log(`export: render unavailable for ${url.pathname}`);
    return rendering202();
  }
  await storePage(env, space, hash, source, out);
  return rawBytes(request, env, key, name, false);
}

async function storePage(env: Env, space: string, hash: string, source: string, out: PageArtifacts): Promise<void> {
  await Promise.all([
    env.BUCKET.put(derivedKey(space, hash, source, 'page', 'pdf'), out.pdf, {
      httpMetadata: { contentType: 'application/pdf' },
    }),
    env.BUCKET.put(derivedKey(space, hash, source, 'page', 'png'), out.fullPng, {
      httpMetadata: { contentType: 'image/png' },
    }),
  ]);
}

export async function exportArtifact(
  request: Request, env: Env, target: ExportTarget,
): Promise<Response> {
  const { space, hash, source, url } = target;

  if (isPageSource(source)) return exportPage(request, env, target);

  /* Deck or document from the content, every time. The bytes have to be read
     before the cache can be checked, because the sniff is what says which key
     this render lands under. */
  const markdown = await readPayload(env, space, hash, source);
  if (markdown === null) return htmlResponse(errorShell(404), 404);
  const mode = sniffDeck(markdown) ? 'slides' : 'doc';

  const key = derivedKey(space, hash, source, mode, 'pdf');
  const name = downloadName(source, 'pdf');
  if (await env.BUCKET.head(key)) return rawBytes(request, env, key, name, false);

  const out = await produce(env, space, hash, source, mode, markdown, url);
  if (!out) return rendering202();

  return rawBytes(request, env, key, name, false);
}
