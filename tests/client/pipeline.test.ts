// @vitest-environment happy-dom

/**
 * The browser pipeline. None of this was reachable from a test before: it lived
 * in public/render.js and in a template literal inside the Worker, so the only
 * assertion available was that two copies of it looked alike.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { highlightAll, renderCode, renderMarkdown, renderDeck } from '../../src/client/pipeline';
import type { MarpitOptions, MarpitRender, MarpitThemeSet } from '../../src/client/vendor';

/* The stubs below satisfy the vendor interfaces structurally, so none of them
   needs a cast: a shape drift in src/client/vendor.d.ts fails here first. */
const THEME_SET = (add: (css: string) => { name: string }): MarpitThemeSet =>
  ({ default: { name: 'default' }, add });

const DECK = '---\nmarp: true\n---\n# One\n\n---\n\n# Two\n';

function stubMarked(): void {
  window.marked = { parse: (md: string) => `<h1>${md.trim()}</h1>` };
}

function stubMarpit(css = 'section{color:red}') {
  const seen: string[] = [];
  window.Marpit = {
    Marpit: class {
      themeSet = THEME_SET((theme) => { seen.push(theme); return { name: 'nt' }; });
      render(markdown: string): MarpitRender {
        seen.push(markdown);
        return { html: `<svg data-marpit-svg>${markdown}</svg>`, css };
      }
    },
  };
  return { seen };
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '<div id="content"></div>';
  window.marked = undefined;
  window.Marpit = undefined;
  window.hljs = undefined;
});

describe('renderMarkdown', () => {
  it('strips front matter using the same function the Worker uses', () => {
    stubMarked();
    const el = document.getElementById('content');
    renderMarkdown(el!, DECK);
    // The `marp: true` fence is gone; the slide-break `---` inside the body is not.
    expect(el!.innerHTML).not.toContain('marp: true');
    expect(el!.innerHTML).toContain('# One');
    expect(el!.innerHTML).toContain('# Two');
  });

  it('renders nothing rather than throwing when the vendor script is missing', () => {
    const el = document.getElementById('content');
    expect(() => renderMarkdown(el!, DECK)).not.toThrow();
    expect(el!.innerHTML).toBe('');
  });
});

describe('renderDeck', () => {
  it('scopes the theme to the slides and puts the css in the head', () => {
    const { seen } = stubMarpit('section{color:red}');
    const host = document.getElementById('content');
    renderDeck(host!, DECK, '/* @theme nt */');

    expect(seen).toContain('/* @theme nt */');
    expect(host!.innerHTML).toContain('data-marpit-svg');
    expect(document.head.querySelector('style')?.textContent).toBe('section{color:red}');
  });

  it('keeps the deck when the theme will not parse', () => {
    const seen: string[] = [];
    window.Marpit = {
      Marpit: class {
        themeSet = THEME_SET(() => { throw new Error('bad theme'); });
        render(markdown: string): MarpitRender {
          seen.push(markdown);
          return { html: '<svg data-marpit-svg></svg>', css: '' };
        }
      },
    };

    const host = document.getElementById('content');
    expect(() => renderDeck(host!, DECK, 'not css')).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(host!.innerHTML).toContain('data-marpit-svg');
  });

  /* The deck and the doc read the same file, so the markdown handed to Marpit
     must be the whole thing - Marpit owns its own front matter. */
  it('hands Marpit the source unstripped', () => {
    const { seen } = stubMarpit();
    renderDeck(document.getElementById('content')!, DECK, '');
    expect(seen).toContain(DECK);
  });
});

describe('renderCode', () => {
  it('sets text, never markup, and picks a grammar from the extension', () => {
    const el = document.getElementById('content');
    renderCode(el!, '<script>alert(1)</script>', 'evil.TS');
    expect(el!.textContent).toBe('<script>alert(1)</script>');
    expect(el!.querySelector('script')).toBeNull();
    expect(el!.className).toBe('language-ts');
  });

  it('leaves the class alone for a file with no extension', () => {
    const el = document.getElementById('content');
    renderCode(el!, 'plain', 'Makefile');
    expect(el!.className).toBe('');
  });
});

describe('highlightAll', () => {
  it('highlights every code block and survives one that throws', () => {
    document.body.innerHTML = '<div id="content"><pre><code>a</code></pre><pre><code>b</code></pre></div>';
    const seen: Element[] = [];
    window.hljs = {
      highlightElement: (el: Element) => {
        seen.push(el);
        if (seen.length === 1) throw new Error('unknown language');
      },
    };
    const root = document.getElementById('content');
    expect(() => highlightAll(root!)).not.toThrow();
    expect(seen).toHaveLength(2);
  });

  it('no-ops without the vendor script', () => {
    expect(() => highlightAll(document)).not.toThrow();
  });
});

describe('the Marpit options the deck and the md shell must agree on', () => {
  it('turns on html and linkify, which commonmark leaves off', () => {
    const options: MarpitOptions[] = [];
    window.Marpit = {
      Marpit: class {
        constructor(opts: MarpitOptions) { options.push(opts); }
        themeSet = THEME_SET(() => ({ name: 'n' }));
        render(): MarpitRender { return { html: '', css: '' }; }
      },
    };

    renderDeck(document.getElementById('content')!, DECK, '');
    expect(options[0]).toEqual({
      inlineSVG: true,
      markdown: ['default', { html: true, linkify: true }],
    });
  });
});

it('does not reach for a network or a timer at import time', () => {
  const spy = vi.spyOn(globalThis, 'fetch');
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
