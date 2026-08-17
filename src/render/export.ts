/**
 * Print HTML for the export formats. The headless browser runs the same Marpit,
 * marked, and highlight.js a viewer runs, so there is one render path and the
 * Worker spends no CPU on markdown.
 *
 * A deck PDF is a different document from the live deck shell: render.js shows
 * one slide at a time behind a `.current` class, so printing the live shell
 * yields a one-page PDF. Here every slide is visible, one per page.
 */

import type { PDFOptions } from '@cloudflare/puppeteer';
import type { Env } from '../lib/types';
import type { RenderMode } from '../lib/exportPath';
import { DECK_THEME, TOKENS, LOCKUP } from '../brand';
import { esc } from './shell';

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
    footerTemplate: `<div style="width:100%;padding:0 16mm;font-size:7pt;font-family:sans-serif;color:#7A7A7A;display:flex;justify-content:space-between;">
<span>${esc(title)}</span><span class="pageNumber"></span></div>`,
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
const SHEETS = ['/vendor/highlight/nt-code.css', '/print.css'];

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
   answer never varies within a deployment. One isolate pays it once. */
let styleCache: Promise<string> | null = null;

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

export async function inlineStyle(env: Env, origin: string): Promise<string> {
  if (!styleCache) styleCache = buildStyle(env, origin).catch((err) => {
    styleCache = null; // a transient asset miss must not poison the isolate
    throw err;
  });
  return styleCache;
}

/* Built from a string because U+2028 and U+2029 are line terminators in JS
   source, so they cannot appear inside a regex literal. */
const LINE_SEP = new RegExp('[\\u2028\\u2029]', 'g');

/** JSON is valid JS. Escaping `<` stops a `</script>` inside the markdown from
    closing the tag it rides in; the line separators are legal JSON but not JS. */
function jsLiteral(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP, (c) => (c.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029'));
}

const HLJS = '/vendor/highlight/highlight.min.js';
const MARKED = '/vendor/marked/marked.min.js';
const MARPIT = '/vendor/marp/marpit.js';

function renderScript(mode: RenderMode): string {
  const body = mode === 'slides'
    ? `var m=new Marpit.Marpit({inlineSVG:true,markdown:['default',{html:true,linkify:true}]});
try{m.themeSet.default=m.themeSet.add(THEME);}catch(e){}
var out=m.render(MD);
var s=document.createElement('style');s.textContent=out.css;document.head.appendChild(s);
el.innerHTML=out.html;`
    : `el.innerHTML=marked.parse(MD);`;

  /* Removing the transient scripts is what makes page.content() a snapshot
     rather than a page that re-renders itself against a live origin. */
  return `var el=document.getElementById('content');
${body}
el.querySelectorAll('pre code').forEach(function(c){try{hljs.highlightElement(c);}catch(e){}});
document.querySelectorAll('script[data-transient]').forEach(function(t){t.remove();});
document.fonts.ready.then(function(){document.documentElement.dataset.ready='1';});`;
}

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
  const theme = mode === 'slides' ? DECK_THEME : '';

  /* An `@page` rule cannot be scoped to a class, so the page box is the one
     piece of print CSS that has to come from here rather than print.css. */
  const page = mode === 'slides'
    ? `@page{size:${DECK_PAGE.width} ${DECK_PAGE.height};margin:0;}`
    : `@page{size:A4;margin:${DOC_MARGIN.top} ${DOC_MARGIN.right} ${DOC_MARGIN.bottom} ${DOC_MARGIN.left};}`;

  /* On `html`, not `body`: tokens.css paints the dark canvas on `html`, and a
     `.theme-light` below it leaves that background on the paper. */
  const rootClass = mode === 'slides' ? 'print-deck' : 'print-doc theme-light';
  const mark = mode === 'slides' ? '' : `<header class="print-mark">${LOCKUP}</header>\n`;
  const scripts = mode === 'slides' ? [HLJS, MARPIT] : [HLJS, MARKED];

  return `<!doctype html>
<html lang="en" class="${rootClass}">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
<base href="${esc(baseHref)}">
<title>${esc(title)} · NoTambourine</title>
<style>${style}${page}</style>
</head>
<body>
${mark}<main id="content"></main>
${scripts.map((s) => `<script data-transient src="${origin}${s}"></script>`).join('\n')}
<script data-transient>
var MD=${jsLiteral(markdown)};
var THEME=${jsLiteral(theme)};
${renderScript(mode)}
</script>
</body>
</html>`;
}
