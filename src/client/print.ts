/**
 * The print page's bootstrap, loaded by the headless browser for the PDF and
 * snapshot exports. It runs the same pipeline the live shell runs, which is the
 * point: this used to be a JavaScript program written inside a template literal
 * in src/render/export.tsx, so the render it performed only resembled the one a
 * viewer got.
 *
 * The markdown arrives in a JSON script block rather than spliced into this
 * file's source, so nothing here has to hand-escape a `</script>` sequence.
 */

import { renderMarkdown, renderDeck } from './pipeline';
import { parseObject, textAt } from '../lib/json';

interface PrintData {
  markdown: string;
  theme: string;
  mode: string;
}

/** The Worker writes this block; a shape it does not recognise renders nothing
    rather than throwing, so a bad export is a blank page and not a hung one. */
function readData(): PrintData | null {
  const el = document.getElementById('print-data');
  if (!el) return null;
  const record = parseObject(el.textContent ?? '');
  if (!record) return null;
  const markdown = textAt(record, 'markdown');
  const theme = textAt(record, 'theme');
  const mode = textAt(record, 'mode');
  if (markdown === null || theme === null || mode === null) return null;
  return { markdown, theme, mode };
}

/* Removing the transient scripts is what makes page.content() a snapshot rather
   than a page that re-renders itself against a live origin. */
function stripTransient(): void {
  for (const el of document.querySelectorAll('[data-transient]')) el.remove();
}

const data = readData();
const host = document.getElementById('content');

if (data && host) {
  if (data.mode === 'slides') renderDeck(host, data.markdown, data.theme);
  else renderMarkdown(host, data.markdown);
}

stripTransient();

/* The exporter waits on this flag, so it has to be set even when the render bailed:
   a blank page that reports ready beats a browser minute spent on a timeout. */
void document.fonts.ready.then(() => {
  document.documentElement.dataset.ready = '1';
});
