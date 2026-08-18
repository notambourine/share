// @vitest-environment happy-dom

/**
 * The print bootstrap, end to end in a DOM. This is what the headless browser
 * runs for a PDF or a snapshot, and until it became a module the only way to
 * check it was to read the template literal it was spelled in.
 *
 * The module does its work at import time, so each case builds the document
 * first and then imports with a fresh registry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarpitRender, MarpitThemeSet } from '../../src/client/vendor';

/* Structural stubs, no casts: a shape drift in src/client/vendor.d.ts fails here. */
const THEME_SET: MarpitThemeSet = { default: { name: 'd' }, add: () => ({ name: 'n' }) };

interface Fixture {
  markdown: string;
  theme: string;
  mode: string;
}

const DECK = '---\nmarp: true\n---\n# One\n\n---\n\n# Two\n';

/** The page src/render/export.tsx emits, minus the inlined stylesheet. Two
    entry points rather than one union, so a malformed block is spelled as one. */
function page(data: Fixture): void {
  pageRaw(JSON.stringify(data));
}

function pageRaw(json: string): void {
  document.head.innerHTML = '';
  document.body.innerHTML = [
    '<header class="print-mark">lockup</header>',
    '<main id="content"></main>',
    `<script type="application/json" id="print-data" data-transient="">${json}</script>`,
    '<script data-transient="" src="/vendor/highlight/highlight.min.js"></script>',
    '<script data-transient="" src="/print.js"></script>',
  ].join('');
}

function stubVendors() {
  const rendered: string[] = [];
  window.marked = {
    parse: (md: string) => { rendered.push(md); return `<h1>${md.trim()}</h1>`; },
  };
  window.Marpit = {
    Marpit: class {
      themeSet = THEME_SET;
      render(md: string): MarpitRender {
        rendered.push(md);
        return { html: '<svg data-marpit-svg></svg>', css: 'section{}' };
      }
    },
  };
  return { rendered };
}

/** happy-dom ships no FontFaceSet, and the exporter waits on this promise. */
function stubFonts(): void {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
}

async function run(): Promise<void> {
  vi.resetModules();
  await import('../../src/client/print');
  // The ready flag is set from a promise callback, so let the microtasks drain.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.resetModules();
  window.marked = undefined;
  window.Marpit = undefined;
  window.hljs = undefined;
  document.documentElement.removeAttribute('data-ready');
  stubFonts();
});

describe('the print page renders from its data block', () => {
  it('renders a doc through marked, front matter stripped', async () => {
    page({ markdown: DECK, theme: '', mode: 'doc' });
    const { rendered } = stubVendors();
    await run();

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).not.toContain('marp: true');
    expect(rendered[0]).toContain('# One');
    expect(document.getElementById('content')?.innerHTML).toContain('<h1>');
  });

  it('renders a deck through Marpit, source unstripped', async () => {
    page({ markdown: DECK, theme: '/* @theme nt */', mode: 'slides' });
    const { rendered } = stubVendors();
    await run();

    expect(rendered).toEqual([DECK]);
    expect(document.head.querySelector('style')?.textContent).toBe('section{}');
  });
});

describe('what makes the result a snapshot', () => {
  it('removes every transient node, its own data block included', async () => {
    page({ markdown: DECK, theme: '', mode: 'doc' });
    stubVendors();
    expect(document.querySelectorAll('[data-transient]')).toHaveLength(3);
    await run();

    expect(document.querySelectorAll('[data-transient]')).toHaveLength(0);
    expect(document.getElementById('print-data')).toBeNull();
    // The rendered content and the brand mark are what survive.
    expect(document.querySelector('.print-mark')).not.toBeNull();
    expect(document.getElementById('content')).not.toBeNull();
  });

  it('flags ready so the exporter stops waiting', async () => {
    page({ markdown: DECK, theme: '', mode: 'doc' });
    stubVendors();
    await run();
    expect(document.documentElement.dataset.ready).toBe('1');
  });
});

describe('a bad page still finishes', () => {
  /* A hung export costs a browser minute; a blank one costs nothing. Each of
     these must still strip and still flag ready. */
  const bad: [string, () => void][] = [
    ['unparseable json', () => pageRaw('{not json')],
    ['wrong shape', () => pageRaw('{"markdown":1}')],
    ['no data block', () => { document.body.innerHTML = '<main id="content"></main>'; }],
  ];

  for (const [name, build] of bad) {
    it(`reports ready on ${name}`, async () => {
      build();
      stubVendors();
      await run();
      expect(document.documentElement.dataset.ready).toBe('1');
      expect(document.getElementById('content')?.innerHTML).toBe('');
      expect(document.querySelectorAll('[data-transient]')).toHaveLength(0);
    });
  }

  it('reports ready when the vendor scripts never loaded', async () => {
    page({ markdown: DECK, theme: '', mode: 'doc' });
    await run();
    expect(document.documentElement.dataset.ready).toBe('1');
  });
});

describe('the data block escape', () => {
  /* export.tsx escapes `<` so a `</script>` in the markdown cannot close the
     block. The browser does not decode entities inside a script element, so the
     escape has to be a JSON one and JSON.parse has to undo it. */
  it('recovers markdown that carries a closing script tag', async () => {
    const hostile = 'before </script><script>alert(1)</script> after\n';
    const json = JSON.stringify({ markdown: hostile, theme: '', mode: 'doc' })
      .replace(/</g, '\\u003c');
    pageRaw(json);
    const { rendered } = stubVendors();
    await run();
    expect(rendered[0]).toBe(hostile);
  });
});
