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

describe('the bootstrap script survives verbatim', () => {
  it('hands the markdown to JS as a JS literal, not as escaped HTML', async () => {
    const html = await print('doc');
    /* jsLiteral turns `<` into `<` so a `</script>` cannot close the tag.
       If JSX had escaped the block instead, this would read `&lt;em&gt;`. */
    expect(html).toContain('\\u003cem>inline\\u003c/em>');
    expect(html).not.toContain('&lt;em&gt;');
    // A quote in the markdown stays a JS string escape, never `&quot;`.
    expect(html).toContain('\\"ampersand\\"');
    expect(html).not.toContain('&quot;ampersand&quot;');
  });

  it('keeps the render call each mode needs', async () => {
    expect(await print('slides')).toContain('new Marpit.Marpit(');
    expect(await print('doc')).toContain('marked.parse(MD)');
  });

  it('marks both script tags transient, which is what makes it a snapshot', async () => {
    const html = await print('doc');
    /* Two vendor tags plus the bootstrap. Counting the opening tag rather than
       the bare word, because the removal selector inside the script says
       `script[data-transient]` and would otherwise count as a fourth. */
    expect(html.match(/<script data-transient=""/g)?.length).toBe(3);
    expect(html).toContain(`document.querySelectorAll('script[data-transient]')`);
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
