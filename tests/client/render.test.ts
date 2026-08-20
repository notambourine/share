// @vitest-environment happy-dom

/**
 * The deck navigation, in a DOM. What matters here is the handoff: the
 * stylesheet shows every slide, and this script is what narrows the deck to one.
 * A page that never got the bundle has to stay readable, so the class it adds is
 * the whole contract between the two.
 *
 * The module does its work at import time, so each case builds the document
 * first and then imports with a fresh registry.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The deck shell src/render/shell.tsx emits, minus the rendered slide content. */
function page(count = 3): void {
  const slides = Array.from({ length: count }, () => '<svg data-marpit-svg></svg>').join('');
  document.body.innerHTML = [
    `<div class="deck"><div class="marpit">${slides}</div></div>`,
    '<nav class="deck-nav" hidden>',
    '<button data-prev>prev</button><span data-count></span><button data-next>next</button>',
    '</nav>',
  ].join('');
}

async function run(): Promise<void> {
  vi.resetModules();
  await import('../../src/client/render');
}

beforeEach(() => {
  vi.resetModules();
  location.hash = '';
  document.body.innerHTML = '';
});

describe('the handoff from CSS to script', () => {
  /* The regression this guards: paging used to live in the stylesheet, so a
     deployed Worker missing render.js served a deck of blank frames. */
  it('claims the host so the stylesheet can page it', async () => {
    page();
    const host = document.querySelector('.deck');
    expect(host?.classList.contains('paged')).toBe(false);

    await run();
    expect(host?.classList.contains('paged')).toBe(true);
  });

  it('marks the first slide current and reveals the nav', async () => {
    page();
    await run();

    const slides = document.querySelectorAll('svg[data-marpit-svg]');
    expect(slides[0].classList.contains('current')).toBe(true);
    expect(slides[1].classList.contains('current')).toBe(false);
    expect(document.querySelector('.deck-nav')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-count]')?.textContent).toBe('1 / 3');
  });

  /* Nothing to page means nothing to claim: leaving the host unclaimed is what
     keeps a document render from being hidden by the deck rules. */
  it('leaves a host with no slides alone', async () => {
    document.body.innerHTML = '<div class="deck"></div>';
    await run();
    expect(document.querySelector('.deck')?.classList.contains('paged')).toBe(false);
  });
});

describe('navigation', () => {
  it('advances and clamps at both ends', async () => {
    page();
    await run();
    const slides = document.querySelectorAll('svg[data-marpit-svg]');
    const next = document.querySelector<HTMLElement>('[data-next]');
    const prev = document.querySelector<HTMLElement>('[data-prev]');

    next?.click();
    expect(slides[1].classList.contains('current')).toBe(true);
    expect(location.hash).toBe('#2');

    prev?.click();
    prev?.click(); // already at the first slide
    expect(slides[0].classList.contains('current')).toBe(true);
  });

  it('opens on the slide named in the hash', async () => {
    page();
    location.hash = '#3';
    await run();

    const slides = document.querySelectorAll('svg[data-marpit-svg]');
    expect(slides[2].classList.contains('current')).toBe(true);
  });
});
