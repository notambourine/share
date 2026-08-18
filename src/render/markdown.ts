/**
 * The markdown render pipeline, in the Worker.
 *
 * This used to run in the viewer's browser: the shell arrived empty, fetched
 * `?raw`, and parsed - two round trips plus 169 KB of parser on a document and
 * 522 KB on a deck. Nothing here ever needed a DOM. `marked` and Marpit are
 * string-in, string-out over markdown-it, and highlight.js needs a DOM only for
 * `highlightElement`, never for `highlight`. So the shell arrives rendered, a
 * crawler reads real text, and the print page stops handing the same three
 * libraries to a headless Chrome that only had to typeset them.
 *
 * The live shell and the print page both render from here, which is what keeps
 * a deck from reading one way on screen and another way in its own PDF.
 */

import { marked } from 'marked';
import { Marpit } from '@marp-team/marpit';
import hljs from '@highlightjs/cdn-assets/es/highlight.min.js';
import { splitFrontMatter } from '../lib/exportPath';

/* Marpit defaults markdown-it to the commonmark preset, which has GFM tables and
   strikethrough off. `marked` renders both, so the deck has to match or the same
   file reads two ways. The `default` preset leaves one difference behind:
   markdown-it spells strikethrough `<s>` and marked spells it `<del>`. Both
   strike the text, so it is not worth a renderer override. */
const MARKDOWN_OPTS = { html: true, linkify: true, highlight: fence };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The info string's language, but only when highlight.js knows it. A miss
 * returns null rather than an unknown class, so nothing from the fence ever
 * reaches an attribute: ```"><script> can only ever come out as plain `hljs`.
 */
function langOf(info: string | undefined): string | null {
  const first = (info ?? '').trim().split(/\s+/)[0].toLowerCase();
  return first && hljs.getLanguage(first) ? first : null;
}

/**
 * One code block, wrapped. markdown-it uses a returned string verbatim when it
 * opens with `<pre`, so this is also what keeps `nt-code.css` working: the theme
 * keys off `.hljs`, which markdown-it's own wrapper would not add.
 */
function fence(code: string, info: string): string {
  const lang = langOf(info);
  const cls = lang ? `hljs language-${lang}` : 'hljs';
  let body: string;
  try {
    body = lang ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : escapeHtml(code);
  } catch {
    body = escapeHtml(code); // plain text is fine
  }
  return `<pre><code class="${cls}">${body}</code></pre>`;
}

/* `marked` carries its own renderer, so the fence hook is registered rather
   than passed. Module scope: it configures the shared instance once. */
marked.use({
  renderer: {
    code({ text, lang }) {
      return fence(text, lang ?? '');
    },
  },
});

/** A document: front matter stripped, GFM, code blocks highlighted. */
export function renderMarkdown(text: string): string {
  return marked.parse(splitFrontMatter(text).body, { async: false });
}

/** A deck's slides and the theme CSS Marpit scoped to them. */
export interface Deck {
  html: string;
  css: string;
}

/**
 * Every slide, with the theme scoped to the slide sections. The live shell then
 * shows one at a time behind `.current`; the print page shows them all, which is
 * the only difference between the two documents.
 */
export function renderDeck(text: string, themeCss: string): Deck {
  const marpit = new Marpit({ inlineSVG: true, markdown: ['default', MARKDOWN_OPTS] });
  /* An unparseable theme must not cost the deck: Marpit's built-in default
     still renders readable slides. */
  if (themeCss) {
    try {
      marpit.themeSet.default = marpit.themeSet.add(themeCss);
    } catch { /* default theme */ }
  }
  const { html, css } = marpit.render(text);
  return { html, css };
}

/** A code file: text, never markup, so the extension only picks a grammar. */
export function renderCode(text: string, filename: string): string {
  const dot = filename.lastIndexOf('.');
  return fence(text, dot > 0 ? filename.slice(dot + 1) : '');
}
