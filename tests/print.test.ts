/**
 * The print documents are mostly payload, not markup: the inlined stylesheet,
 * the bootstrap script, and the lockup are already-built strings that ride
 * through `raw()`. Escape one of them and the snapshot breaks in a way no
 * shell test would notice - a `&gt;` inside a CSS selector, a `&quot;` inside
 * the render script - so these tests pin the raw boundary from both sides.
 */

import { describe, expect, it } from 'vitest';
import type { AssetServer } from '../src/lib/types';
import { printHtml, pdfOptionsFor } from '../src/render/export';
import { LOCKUP } from '../src/brand';
import { parseObject, textAt } from '../src/lib/json';
import { testEnv } from './bindings';

/* Every character the JSX escape would rewrite, inside real CSS syntax. */
const STUB_CSS = `.a>.b{content:'"'}.c[data-x="1"]{--q:'&'}`;
const MARKDOWN = '# One\n\nan <em>inline</em> tag & an "ampersand"\n';

function assets(): AssetServer {
  return {
    fetch: async (req: Request) => {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith('/fonts/')) return new Response(new Uint8Array([0, 1, 2]));
      return new Response(STUB_CSS);
    },
  };
}

const env = testEnv({ assets: assets() });

const print = (mode: 'slides' | 'doc' | 'page', title = 'deck.md') =>
  printHtml(env, {
    origin: 'https://share.test',
    baseHref: 'https://share.test/acme/Xk92mQ7bTp01/',
    title,
    markdown: MARKDOWN,
    mode,
  });

describe('the inlined stylesheet survives verbatim', () => {
  it('leaves CSS punctuation alone inside the style element', async () => {
    const html = await print('doc');
    expect(html).toContain(STUB_CSS);
    expect(html).not.toContain('.a&gt;.b');
    expect(html).not.toContain('&quot;1&quot;');
  });

  it('keeps the @page rule the paper size depends on', async () => {
    expect(await print('slides')).toContain('@page{size:1152px 648px;margin:0;}');
    expect(await print('doc')).toContain('@page{size:A4;margin:18mm 16mm 20mm 16mm;}');
  });
});

interface PrintData {
  markdown: string;
  theme: string;
  mode: string;
}

/** The data block as the browser reads it: the text of #print-data, decoded the
    same way src/client/print.ts decodes it. */
function printData(html: string): PrintData {
  const m = /<script type="application\/json" id="print-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('no #print-data block');
  const record = parseObject(m[1]);
  if (!record) throw new Error('#print-data is not JSON');
  const markdown = textAt(record, 'markdown');
  const theme = textAt(record, 'theme');
  const mode = textAt(record, 'mode');
  if (markdown === null || theme === null || mode === null) throw new Error('#print-data is the wrong shape');
  return { markdown, theme, mode };
}

describe('the markdown reaches the page as data, not as source', () => {
  it('round-trips the markdown through the JSON block', async () => {
    const data = printData(await print('doc'));
    expect(data.markdown).toBe(MARKDOWN);
    expect(data.mode).toBe('doc');
  });

  /* The reason this block exists rather than a `var MD=` literal: the escape is
     one rule (`<`), and JSON.parse undoes it, so no U+2028 handling is needed. */
  it('survives a closing script tag inside the markdown', async () => {
    const hostile = 'text </script><script>alert(1)</script> more\u2028and a separator\n';
    const html = await printHtml(env, {
      origin: 'https://share.test',
      baseHref: 'https://share.test/a/',
      title: 'x',
      markdown: hostile,
      mode: 'doc',
    });
    // Nothing closed the block early, so exactly one script tag opened per source.
    expect(html).not.toContain('</script><script>alert(1)');
    expect(printData(html).markdown).toBe(hostile);
  });

  it('carries the deck theme only where a deck needs it', async () => {
    expect(printData(await print('slides')).theme).toContain('@theme');
    expect(printData(await print('doc')).theme).toBe('');
  });
});

describe('the page loads the shared pipeline, not its own copy', () => {
  it('gives each mode its renderer plus print.js', async () => {
    const slides = await print('slides');
    expect(slides).toContain('src="https://share.test/vendor/marp/marpit.js"');
    expect(slides).toContain('src="https://share.test/print.js"');
    expect(slides).not.toContain('marked.min.js');

    const doc = await print('doc');
    expect(doc).toContain('src="https://share.test/vendor/marked/marked.min.js"');
    expect(doc).toContain('src="https://share.test/print.js"');
    expect(doc).not.toContain('marpit.js');
  });

  /* src/client/print.ts strips every `[data-transient]` node, the data block
     included, and that is what leaves a snapshot rather than a live page. */
  it('marks the data block and all three scripts transient', async () => {
    const html = await print('doc');
    expect(html.match(/data-transient=""/g)?.length).toBe(4);
  });
});

describe('the lockup and the attributes', () => {
  it('inlines the lockup on a document and leaves it off a deck', async () => {
    expect(await print('doc')).toContain(LOCKUP);
    expect(await print('slides')).not.toContain('print-mark');
  });

  it('carries the root class the paper theme depends on', async () => {
    expect(await print('slides')).toContain('class="print-deck"');
    expect(await print('doc')).toContain('class="print-doc theme-light"');
  });

  it('escapes a hostile title and base href, which are the only untrusted spots', async () => {
    const html = await printHtml(env, {
      origin: 'https://share.test',
      baseHref: 'https://share.test/a" onload="alert(1)/',
      title: '<img src=x onerror=alert(1)>',
      markdown: MARKDOWN,
      mode: 'doc',
    });
    expect(html).toContain('<title>&lt;img src=x onerror=alert(1)&gt; · NoTambourine</title>');
    expect(html).not.toContain('onload="alert(1)"');
  });
});

describe('pdfOptionsFor', () => {
  it('escapes the title it prints into Chrome\'s own footer document', () => {
    const opts = pdfOptionsFor('doc', '<img src=x onerror=alert(1)>');
    expect(opts.footerTemplate).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(opts.footerTemplate).toContain('class="pageNumber"');
  });

  it('gives a deck the slide box and a page no footer chrome', () => {
    expect(pdfOptionsFor('slides', 't')).toMatchObject({ width: '1152px', height: '648px' });
    expect(pdfOptionsFor('page', 't').displayHeaderFooter).toBeUndefined();
  });
});
