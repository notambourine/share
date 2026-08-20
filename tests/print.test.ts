/**
 * The print documents are mostly payload, not markup: the inlined stylesheet, the
 * rendered content, and the lockup are already-built strings that ride through
 * `raw()`. Escape one of them and the PDF breaks in a way no shell test would
 * notice - a `&gt;` inside a CSS selector, a `&quot;` inside a rendered
 * attribute - so these tests pin the raw boundary from both sides.
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

  /* The sheets are fetched from the origin, so the cache is keyed by it: a
     second hostname must get its own stylesheet, not the first one's. */
  it('builds one stylesheet per origin', async () => {
    const perOrigin = testEnv({
      assets: { fetch: async (req: Request) => new Response(`/* ${new URL(req.url).origin} */`) },
    });
    const html = (origin: string) => printHtml(perOrigin, {
      origin, baseHref: `${origin}/a/`, title: 't', markdown: MARKDOWN, mode: 'doc',
    });
    expect(await html('https://one.test')).toContain('/* https://one.test */');
    expect(await html('https://two.test')).toContain('/* https://two.test */');
  });

  it('keeps the @page rule the paper size depends on', async () => {
    expect(await print('slides')).toContain('@page{size:1152px 648px;margin:0;}');
    expect(await print('doc')).toContain('@page{size:A4;margin:18mm 24mm 20mm 24mm;}');
  });
});

describe('the markdown arrives rendered, not as a payload to parse', () => {
  it('lays a document out before the browser ever sees it', async () => {
    const html = await print('doc');
    expect(html).toContain('<h1>One</h1>');
    // Raw HTML in the markdown still passes through, as it does on the shell.
    expect(html).toContain('<em>inline</em>');
  });

  it('lays a deck out as slides, theme scoped and inlined', async () => {
    const html = await print('slides');
    expect(html).toContain('data-marpit-svg');
    /* Marpit scopes the theme to its own sections, so it is inlined rather than
       linked: bare `section` rules would otherwise reach the whole page. */
    expect(html).toContain('svg[data-marpit-svg]');
  });

  /* Raw HTML in markdown passes through here as it does on the shell: an upload
     is Bearer-gated and already runs on this origin. What went away is the JSON
     block the markdown used to ride in, so there is no `</script>` escape left to
     get wrong - the page's own script tag cannot be closed by its content. */
  it('passes raw HTML through and keeps its own script tag whole', async () => {
    const html = await printHtml(env, {
      origin: 'https://share.test',
      baseHref: 'https://share.test/a/',
      title: 'x',
      markdown: 'text </script><script>alert(1)</script> more\n',
      mode: 'doc',
    });
    expect(html).toContain('<script>alert(1)</script>');
    expect(html).toContain('src="https://share.test/print.js"');
    expect(html.match(/data-transient=""/g)).toHaveLength(1);
  });
});

describe('the page carries one script and it removes itself', () => {
  it('loads print.js and no renderer at all', async () => {
    for (const mode of ['slides', 'doc'] as const) {
      const html = await print(mode);
      expect(html).toContain('src="https://share.test/print.js"');
      expect(html).not.toContain('marpit.js');
      expect(html).not.toContain('marked.min.js');
      expect(html).not.toContain('highlight.min.js');
    }
  });

  /* src/client/print.ts strips every `[data-transient]` node, itself included,
     and that is what leaves a document with no JavaScript in it. */
  it('marks its one script transient', async () => {
    expect((await print('doc')).match(/data-transient=""/g)).toHaveLength(1);
  });
});

describe('the lockup and the attributes', () => {
  /* Two routes to the same mark, because a deck has no element to hang one on:
     Marpit generates every node inside a slide, so a document gets the lockup as
     markup in a header and a deck gets it from the theme as a background image.
     The `print-mark` header would sit outside the slide box on a deck, which is
     why it stays off. */
  it('inlines the lockup on a document and leaves the header off a deck', async () => {
    expect(await print('doc')).toContain(LOCKUP);
    expect(await print('slides')).not.toContain('print-mark');
  });

  /* The regression this whole change exists for: a deck PDF left as an email
     attachment with nothing on it saying who made it. The mark reaches the page
     only if logo-vars.css is in the inlined token bundle AND the theme draws it,
     so assert both halves - either one alone renders a blank corner. */
  it('carries the running lockup on a deck, as a data URI the paper can print', async () => {
    const html = await print('slides');
    expect(html).toContain('--nt-lockup-url');
    expect(html).toContain('background: var(--nt-lockup-url)');
    // A data URI, never an origin: printed paper has nothing to fetch from.
    expect(html).toContain('url("data:image/svg+xml,');
    expect(html).not.toContain('url("/logo/lockup.svg")');
  });

  it('gives the cover its own lockup and no page number', async () => {
    const html = await print('slides');
    expect(html).toContain('section.lead::before');
    expect(html).toContain('section.lead::after');
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
