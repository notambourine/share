/**
 * Export formats: cache lookup, render, serve.
 *
 * Derived artifacts cache under `<space>/<hash>/d/v<N>/`. Delete and the nightly
 * sweep list the whole `<space>/<hash>/` prefix, so they trash and purge with
 * their upload and need nothing here.
 */

import type { Env, Meta } from '../lib/types';
import {
  type ExportFormat, type RenderMode,
  explicitMode, formatExt, derivedKey, checkKey, sniffDeck, isPageSource, pageExt,
} from '../lib/exportPath';
import { render, renderPage, type Artifacts, type PageArtifacts } from '../lib/pdf';
import { printHtml, pdfOptionsFor } from '../render/export';
import { rawBytes } from '../lib/bytes';
import { fileShell, errorShell } from '../render/shell';
import { htmlResponse, ROBOTS, SNAPSHOT_CSP } from '../lib/http';

/** Pre-rendering the whole upload could spend the daily browser budget on one
    push, so the rest waits for someone to ask for it. */
const MAX_PRERENDER = 3;

export interface ExportTarget {
  space: string;
  hash: string;
  /** The uploaded markdown file the suffix hangs off. */
  source: string;
  format: ExportFormat;
  /** The requested URL, so the `/k/` segment and the directory ride along. */
  url: URL;
  size: number;
}

function readSource(env: Env, space: string, hash: string, source: string): Promise<string | null> {
  return env.BUCKET.get(`${space}/${hash}/f/${source}`).then((o) => (o ? o.text() : null));
}

function baseName(source: string): string {
  const name = source.slice(source.lastIndexOf('/') + 1);
  return name.replace(/\.(md|markdown|html?)$/i, '') || name;
}

/** `deck.slides.pdf` downloads as `deck.pdf`; the mode is grammar, not a name. */
function downloadName(source: string, ext: 'html' | 'pdf' | 'txt' | 'png'): string {
  return `${baseName(source)}.${ext}`;
}

async function store(env: Env, space: string, hash: string, source: string, mode: RenderMode, out: Artifacts): Promise<void> {
  await Promise.all([
    env.BUCKET.put(derivedKey(space, hash, source, mode, 'html'), out.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    }),
    env.BUCKET.put(derivedKey(space, hash, source, mode, 'pdf'), out.pdf, {
      httpMetadata: { contentType: 'application/pdf' },
    }),
    ...(out.check ? [env.BUCKET.put(checkKey(space, hash, source), JSON.stringify(out.check), {
      httpMetadata: { contentType: 'application/json' },
    })] : []),
  ]);
}

/** One page load, both artifacts, both stored. Null means the browser was
    unreachable and the caller degrades. */
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

/** Rate limit hit, budget spent, or no binding. `.html` keeps the live
    client-side shell; a binary format gets the 202. */
function degrade(target: ExportTarget, mode: RenderMode, ext: 'html' | 'pdf'): Response {
  const { url, source, size } = target;
  console.log(`export: render unavailable for ${url.pathname}`);
  if (ext === 'pdf') return rendering202();
  const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  const rawHref = `${url.origin}${dir}${encodeURI(source)}?raw`;
  return htmlResponse(fileShell(mode === 'slides' ? 'slides' : 'md', source, rawHref, size));
}

/** No prerender for a page (decision 9): the first GET - the admin tile's
    click - pays the render. One load stores all three outputs, so the other
    two tiles flip ready on the same click. */
async function exportPage(request: Request, env: Env, target: ExportTarget): Promise<Response> {
  const { space, hash, source, format, url } = target;
  if (format === 'txt') return htmlResponse(errorShell(404), 404); // never resolved; belt and braces
  const ext = pageExt(format);
  const key = derivedKey(space, hash, source, 'page', ext);
  const name = downloadName(source, ext === 'pdf' ? 'pdf' : 'png');
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

function storePage(env: Env, space: string, hash: string, source: string, out: PageArtifacts): Promise<unknown> {
  return Promise.all([
    env.BUCKET.put(derivedKey(space, hash, source, 'page', 'pdf'), out.pdf, {
      httpMetadata: { contentType: 'application/pdf' },
    }),
    env.BUCKET.put(derivedKey(space, hash, source, 'page', 'browser.png'), out.browserPng, {
      httpMetadata: { contentType: 'image/png' },
    }),
    env.BUCKET.put(derivedKey(space, hash, source, 'page', 'full.png'), out.fullPng, {
      httpMetadata: { contentType: 'image/png' },
    }),
  ]);
}

export async function exportArtifact(
  request: Request, env: Env, target: ExportTarget,
): Promise<Response> {
  const { space, hash, source, format, url } = target;

  if (isPageSource(source)) return exportPage(request, env, target);

  /* `.txt` is the source's own bytes as text/plain, always: it renders
     nothing and survives being pasted where a query string would not. */
  if (format === 'txt') {
    return rawBytes(request, env, `${space}/${hash}/f/${source}`, downloadName(source, 'txt'), false);
  }

  const ext = formatExt(format);
  let mode = explicitMode(format);
  let markdown: string | null = null;

  if (!mode) {
    markdown = await readSource(env, space, hash, source);
    if (markdown === null) return htmlResponse(errorShell(404), 404);
    mode = sniffDeck(markdown) ? 'slides' : 'doc';
  }

  const key = derivedKey(space, hash, source, mode, ext);
  const name = downloadName(source, ext);
  if (await env.BUCKET.head(key)) return serveDerived(request, env, key, name, ext);

  if (markdown === null) markdown = await readSource(env, space, hash, source);
  if (markdown === null) return htmlResponse(errorShell(404), 404);

  const out = await produce(env, space, hash, source, mode, markdown, url);
  if (!out) return degrade(target, mode, ext);

  return serveDerived(request, env, key, name, ext);
}

async function serveDerived(
  request: Request, env: Env, key: string, name: string, ext: 'html' | 'pdf',
): Promise<Response> {
  const res = await rawBytes(request, env, key, name, false);
  if (ext === 'html' && res.status < 300) {
    res.headers.set('content-security-policy', SNAPSHOT_CSP);
  }
  return res;
}

/**
 * Warm the cache at upload time, so the first person to open the link waits on
 * R2 rather than on a browser. Runs in `ctx.waitUntil`; every failure is a log
 * line and an on-demand render later.
 */
export async function prerender(env: Env, url: URL, meta: Meta): Promise<void> {
  const markdown = meta.files.filter((f) => /\.(md|markdown)$/i.test(f.path));
  const take = markdown.slice(0, MAX_PRERENDER);
  const deferred = markdown.length - take.length;
  if (deferred > 0) {
    console.log(`prerender: ${meta.space}/${meta.hash} deferred ${deferred} of ${markdown.length} to on demand`);
  }

  for (const file of take) {
    const text = await readSource(env, meta.space, meta.hash, file.path);
    if (text === null) continue;
    const mode: RenderMode = sniffDeck(text) ? 'slides' : 'doc';
    const at = new URL(`${url.origin}/${meta.space}/${meta.hash}/${encodeURI(file.path)}`);
    const out = await produce(env, meta.space, meta.hash, file.path, mode, text, at);
    if (!out) {
      console.log(`prerender: ${meta.space}/${meta.hash}/${file.path} deferred to on demand`);
      return; // the budget is account-wide; the next file would fail the same way
    }
  }
}
