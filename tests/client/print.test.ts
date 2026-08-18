// @vitest-environment happy-dom

/**
 * The print bootstrap, in a DOM. It used to render the markdown; now the Worker
 * does, and the two things left are the two the PDF depends on: nothing
 * executable survives in the document, and the exporter is told when to typeset.
 *
 * The module does its work at import time, so each case builds the document
 * first and then imports with a fresh registry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The page src/render/export.tsx emits, minus the inlined stylesheet. */
function page(content = '<h1>One</h1>'): void {
  document.head.innerHTML = '';
  document.body.innerHTML = [
    '<header class="print-mark">lockup</header>',
    `<main id="content">${content}</main>`,
    '<script data-transient="" src="/print.js"></script>',
  ].join('');
}

/** happy-dom ships no FontFaceSet, and the exporter waits on this promise. */
function stubFonts(ready: Promise<void> = Promise.resolve()): void {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready },
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
  document.documentElement.removeAttribute('data-ready');
  stubFonts();
});

describe('what makes the result a snapshot', () => {
  it('removes every transient node, its own tag included', async () => {
    page();
    expect(document.querySelectorAll('[data-transient]')).toHaveLength(1);
    await run();

    expect(document.querySelectorAll('[data-transient]')).toHaveLength(0);
    expect(document.querySelector('script')).toBeNull();
    // The rendered content and the brand mark are what survive.
    expect(document.querySelector('.print-mark')).not.toBeNull();
    expect(document.getElementById('content')?.innerHTML).toBe('<h1>One</h1>');
  });

  it('leaves the Worker-rendered markup untouched', async () => {
    page('<svg data-marpit-svg></svg><svg data-marpit-svg></svg>');
    await run();
    expect(document.querySelectorAll('svg[data-marpit-svg]')).toHaveLength(2);
  });
});

describe('the ready flag', () => {
  it('flags ready so the exporter stops waiting', async () => {
    page();
    await run();
    expect(document.documentElement.dataset.ready).toBe('1');
  });

  /* A hung export costs a browser minute; one typeset in the fallback face costs
     nothing. `fonts.ready` resolves either way, so the flag is not conditional. */
  it('flags ready on a page with no content at all', async () => {
    document.body.innerHTML = '';
    await run();
    expect(document.documentElement.dataset.ready).toBe('1');
  });

  it('does not flag ready before the faces land', async () => {
    page();
    let land = (): void => {};
    stubFonts(new Promise<void>((r) => { land = r; }));
    await run();
    expect(document.documentElement.dataset.ready).toBeUndefined();

    land();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.dataset.ready).toBe('1');
  });
});
