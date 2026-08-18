/**
 * Print HTML for the PDF exports. The markup arrives rendered from
 * src/render/markdown.ts - the same module the live shell renders from - so the
 * browser here only typesets. It used to be handed the markdown plus the three
 * parser libraries and asked to do the render itself, which meant a page load
 * could not start laying out until 500 KB of JavaScript had parsed.
 *
 * A deck PDF is a different document from the live deck shell: the shell shows
 * one slide at a time behind a `.current` class, so printing it yields a
 * one-page PDF. Here every slide is visible, one per page.
 *
 * Unlike the shells, most of this document is payload rather than markup: the
 * inlined stylesheet, the rendered content, and the lockup are already-built
 * strings and every one goes through `raw()`. JSX still owns the attributes and
 * the title, which is where a filename could otherwise break out.
 */

import type { PDFOptions } from '@cloudflare/puppeteer';
import { raw } from 'hono/html';
import type { Env } from '../lib/types';
import type { RenderMode } from '../lib/exportPath';
import { TOKENS, LOCKUP, token } from '../brand';
import { renderSource } from './markdown';

/** 1152x648 is 16:9 at the same aspect as Marpit's 1280x720 slide box. */
const DECK_PAGE = { width: '1152px', height: '648px' };

const DOC_MARGIN = { top: '18mm', right: '16mm', bottom: '20mm', left: '16mm' };

export function pdfOptionsFor(mode: RenderMode, title: string): PDFOptions {
  if (mode === 'slides') {
    return {
      ...DECK_PAGE,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    };
  }
  /* An uploaded page brings its own layout and maybe its own print CSS, so it
     gets plain A4 and none of the doc footer chrome. */
  if (mode === 'page') return { format: 'A4', printBackground: true };
  /* Headless Chrome implements no CSS Paged Media margin box, so `@bottom-center`
     never fires and the page number has to come from footerTemplate. Chrome
     renders that in its own document, hence the inline styles and no brand face. */
  return {
    format: 'A4',
    printBackground: true,
    margin: DOC_MARGIN,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `${
      <div style={`width:100%;padding:0 16mm;font-size:7pt;font-family:sans-serif;color:${token('--nt-mid')};display:flex;justify-content:space-between;`}>
        <span>{title}</span><span class="pageNumber"></span>
      </div>
    }`,
  };
}

/**
 * Faces inlined as `data:` URIs so a snapshot opens from a mail attachment.
 *
 * Both italics earn their place: a missing face does not fall back cleanly, the
 * browser synthesizes a slanted upright, and JetBrains Mono backs `--font-body`
 * so markdown `*emphasis*` reaches its italic.
 *
 * No Nunito, which the golden set carries only for the wordmark: the lockup is
 * outlined artwork, so no page here renders `--font-wordmark`.
 */
const FACES: { file: string; family: string; style: string; weight: string }[] = [
  { file: 'hanken-grotesk-latin-var.woff2', family: 'Hanken Grotesk', style: 'normal', weight: '100 900' },
  { file: 'hanken-grotesk-latin-var-italic.woff2', family: 'Hanken Grotesk', style: 'italic', weight: '100 900' },
  { file: 'jetbrains-mono-latin-var.woff2', family: 'JetBrains Mono', style: 'normal', weight: '100 800' },
  { file: 'jetbrains-mono-latin-var-italic.woff2', family: 'JetBrains Mono', style: 'italic', weight: '100 800' },
];

/* tokens.css is missing here because it is not an asset: src/brand.ts imports it
   from the golden set and it is already a string in this bundle. */
const SHEETS = ['/nt-code.css', '/print.css'];

function base64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x2000; // spreading the whole array into fromCharCode blows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function asset(env: Env, origin: string, path: string): Promise<string> {
  const res = await env.ASSETS.fetch(new Request(`${origin}${path}`));
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  return res.text();
}

/* Assembling 155 KB of base64 costs real CPU against a 10 ms budget, and the
   answer never varies within a deployment. One isolate pays it once per origin -
   the origin is what the sheets are fetched from, so it cannot be dropped. */
const styleCache = new Map<string, Promise<string>>();

function buildStyle(env: Env, origin: string): Promise<string> {
  return (async () => {
    const faces = await Promise.all(FACES.map(async (f) => {
      const res = await env.ASSETS.fetch(new Request(`${origin}/fonts/${f.file}`));
      if (!res.ok) throw new Error(`font ${f.file}: ${res.status}`);
      const b64 = base64(new Uint8Array(await res.arrayBuffer()));
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
    }));
    const sheets = [TOKENS, ...await Promise.all(SHEETS.map((p) => asset(env, origin, p)))];
    /* tokens.css declares the same families against `./fonts/*.woff2`, which a
       snapshot opened from disk cannot reach. Drop those blocks and let the
       data: rules above stand alone. Safe while tokens.css keeps @font-face
       flat, which it does. */
    const stripped = sheets.map((css) => css.replace(/@font-face\s*\{[^}]*\}/g, ''));
    return faces.join('') + stripped.join('\n');
  })();
}

export function inlineStyle(env: Env, origin: string): Promise<string> {
  let pending = styleCache.get(origin);
  if (!pending) {
    pending = buildStyle(env, origin).catch((err) => {
      styleCache.delete(origin); // a transient asset miss must not poison the isolate
      throw err;
    });
    styleCache.set(origin, pending);
  }
  return pending;
}

/* The one script left. It waits for the faces to land, flags the document ready,
   and removes every `data-transient` node - itself included - so `page.pdf()`
   typesets a document with no JavaScript in it at all. */
const PRINT = '/print.js';

export interface PrintOpts {
  origin: string;
  /** The requested URL's directory, so relative images in the markdown resolve. */
  baseHref: string;
  title: string;
  markdown: string;
  mode: RenderMode;
}

export async function printHtml(env: Env, opts: PrintOpts): Promise<string> {
  const { origin, baseHref, title, markdown, mode } = opts;
  const style = await inlineStyle(env, origin);
  const out = renderSource(markdown, mode);

  /* An `@page` rule cannot be scoped to a class, so the page box is the one
     piece of print CSS that has to come from here rather than print.css. */
  const page = mode === 'slides'
    ? `@page{size:${DECK_PAGE.width} ${DECK_PAGE.height};margin:0;}`
    : `@page{size:A4;margin:${DOC_MARGIN.top} ${DOC_MARGIN.right} ${DOC_MARGIN.bottom} ${DOC_MARGIN.left};}`;

  /* On `html`, not `body`: tokens.css paints the dark canvas on `html`, and a
     `.theme-light` below it leaves that background on the paper. */
  const rootClass = mode === 'slides' ? 'print-deck' : 'print-doc theme-light';

  return `<!doctype html>\n${
    <html lang="en" class={rootClass}>
      <head>
        <meta charset="utf-8" />
        <meta name="robots" content="noindex, nofollow, noarchive, noimageindex" />
        <base href={baseHref} />
        <title>{`${title} · NoTambourine`}</title>
        <style>{raw(style)}{raw(page)}</style>
        {out.css === null ? null : <style>{raw(out.css)}</style>}
      </head>
      <body>
        {mode === 'slides' ? null : <header class="print-mark">{raw(LOCKUP)}</header>}
        <main id="content">{raw(out.html)}</main>
        <script data-transient="" src={`${origin}${PRINT}`}></script>
      </body>
    </html>
  }`;
}
