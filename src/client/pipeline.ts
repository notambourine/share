/**
 * The markdown render pipeline, shared by the live shell and the print page.
 *
 * These two used to be separate implementations - one real module in
 * public/render.js, one JavaScript program written inside a template literal in
 * src/render/export.tsx - which meant the Marpit options below were declared
 * twice and had to agree by hand. They did not have to: a deck that renders one
 * way on screen and another way in its own PDF is the bug that duplication was
 * always going to produce.
 */

import { splitFrontMatter } from '../lib/exportPath';

/* Marpit defaults markdown-it to the commonmark preset, which has GFM tables and
   strikethrough off. `marked` renders both on the md shell, so the deck has to
   match or the same file reads two ways. */
const MARKDOWN: [string, { html: boolean; linkify: boolean }] = [
  'default', { html: true, linkify: true },
];

export function highlightAll(root: ParentNode): void {
  const hljs = window.hljs;
  if (!hljs) return;
  for (const el of root.querySelectorAll('pre code')) {
    try { hljs.highlightElement(el); } catch { /* plain text is fine */ }
  }
}

/** A code file: text, never markup, so the extension only picks a grammar. */
export function renderCode(el: Element, text: string, filename: string): void {
  el.textContent = text;
  const dot = filename.lastIndexOf('.');
  if (dot > 0) el.className = `language-${filename.slice(dot + 1).toLowerCase()}`;
  const hljs = window.hljs;
  if (!hljs) return;
  try { hljs.highlightElement(el); } catch { /* plain text is fine */ }
}

/* innerHTML is deliberate: uploads are Bearer-gated and raw HTML uploads already
   run on this origin, which holds no ambient credential. */
export function renderMarkdown(el: Element, text: string): void {
  const marked = window.marked;
  if (!marked) return;
  el.innerHTML = marked.parse(splitFrontMatter(text).body);
  highlightAll(el);
}

/**
 * Every slide, with the theme scoped to the slide sections. The live shell then
 * shows one at a time behind `.current`; the print page shows them all, which is
 * the only difference between the two documents.
 */
export function renderDeck(host: Element, text: string, themeCss: string): void {
  const vendor = window.Marpit;
  if (!vendor) return;
  const marpit = new vendor.Marpit({ inlineSVG: true, markdown: MARKDOWN });
  /* An unparseable theme must not cost the deck: Marpit's built-in default
     still renders readable slides. */
  if (themeCss) {
    try { marpit.themeSet.default = marpit.themeSet.add(themeCss); } catch { /* default theme */ }
  }
  const out = marpit.render(text);
  const style = document.createElement('style');
  style.textContent = out.css;
  document.head.appendChild(style);
  host.innerHTML = out.html;
  highlightAll(host);
}
