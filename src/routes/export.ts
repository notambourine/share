/**
 * Export formats: cache lookup, render, serve.
 *
 * Derived artifacts cache under `<space>/<hash>/d/v<N>/`. Delete and the nightly
 * sweep list the whole `<space>/<hash>/` prefix, so they trash and purge with
 * their upload and need nothing here.
 */

import type { Env, Meta } from '../lib/types';
import {
  type ExportFormat, type Shape,
  explicitShape, formatExt, derivedKey, sniffDeck,
} from '../lib/exportPath';
import { render, type Artifacts } from '../lib/pdf';
import { printHtml, pdfOptionsFor } from '../render/export';
import { rawBytes } from '../lib/bytes';
import { fileShell, errorShell } from '../render/shell';
import { htmlResponse, SNAPSHOT_CSP } from '../lib/http';

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
  return name.replace(/\.(md|markdown)$/i, '') || name;
}

/** `deck.md.slides.pdf` downloads as `deck.pdf`; the suffix is grammar, not a name. */
function downloadName(source: string, ext: 'html' | 'pdf'): string {
  return `${baseName(source)}.${ext}`;
}

async function store(env: Env, space: string, hash: string, source: string, shape: Shape, out: Artifacts): Promise<void> {
  await Promise.all([
    env.BUCKET.put(derivedKey(space, hash, source, shape, 'html'), out.html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    }),
    env.BUCKET.put(derivedKey(space, hash, source, shape, 'pdf'), out.pdf, {
      httpMetadata: { contentType: 'application/pdf' },
    }),
  ]);
}

/** One page load, both artifacts, both stored. Null means the browser was
    unreachable and the caller degrades. */
async function produce(
  env: Env, space: string, hash: string, source: string, shape: Shape, markdown: string, url: URL,
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
      shape,
    });
  } catch (err) {
    console.log(`export: print HTML failed: ${err}`);
    return null;
  }
  const out = await render(env.BROWSER, html, pdfOptionsFor(shape, title));
  if (out) await store(env, space, hash, source, shape, out);
  return out;
}

/** Rate limit hit, budget spent, or no binding: hand back the live client-side
    shell. A missing PDF is a worse day than a broken one. */
function degrade(target: ExportTarget, shape: Shape): Response {
  const { url, source, size } = target;
  const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  const rawHref = `${url.origin}${dir}${encodeURI(source)}?raw`;
  console.log(`export: render unavailable, serving the live shell for ${url.pathname}`);
  return htmlResponse(fileShell(shape === 'slides' ? 'slides' : 'md', source, rawHref, size));
}

export async function exportArtifact(
  request: Request, env: Env, target: ExportTarget,
): Promise<Response> {
  const { space, hash, source, format, url, size } = target;

  /* `.slides.html` and `?slides` are the same live deck: client-side, current
     with the brand on every load, and no browser minute spent. */
  if (format === 'slides-html') {
    const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    return htmlResponse(fileShell('slides', source, `${url.origin}${dir}${encodeURI(source)}?raw`, size));
  }

  const ext = formatExt(format);
  let shape = explicitShape(format);
  let markdown: string | null = null;

  if (!shape) {
    markdown = await readSource(env, space, hash, source);
    if (markdown === null) return htmlResponse(errorShell(404), 404);
    shape = sniffDeck(markdown) ? 'slides' : 'doc';
  }

  const key = derivedKey(space, hash, source, shape, ext);
  const name = downloadName(source, ext);
  if (await env.BUCKET.head(key)) return serveDerived(request, env, key, name, ext);

  if (markdown === null) markdown = await readSource(env, space, hash, source);
  if (markdown === null) return htmlResponse(errorShell(404), 404);

  const out = await produce(env, space, hash, source, shape, markdown, url);
  if (!out) return degrade(target, shape);

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
    const shape: Shape = sniffDeck(text) ? 'slides' : 'doc';
    const at = new URL(`${url.origin}/${meta.space}/${meta.hash}/${encodeURI(file.path)}`);
    const out = await produce(env, meta.space, meta.hash, file.path, shape, text, at);
    if (!out) {
      console.log(`prerender: ${meta.space}/${meta.hash}/${file.path} deferred to on demand`);
      return; // the budget is account-wide; the next file would fail the same way
    }
  }
}
