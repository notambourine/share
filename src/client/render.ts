/* Client-side rendering for share shells. The Worker only emits markup;
   highlighting, markdown, and slides happen here (vendored libs, no CDN). */

import { renderCode, renderMarkdown, renderDeck } from './pipeline';

const body = document.body;
const kind = body.dataset.kind;
const raw = body.dataset.raw;

const copy = document.querySelector('[data-copy]');
if (copy) {
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(location.origin + location.pathname).then(() => {
      copy.textContent = 'copied';
      setTimeout(() => { copy.textContent = 'copy link'; }, 1500);
    });
  });
}

function withText(href: string, fn: (text: string) => void): void {
  void fetch(href).then((r) => r.text()).then(fn);
}

/**
 * One slide at a time, with the index in the hash so a link can point at slide 7.
 * Marpit emits every slide as a sibling svg; navigation is ours. The print page
 * shares the render but never this, because a PDF shows every slide.
 */
function deck(host: Element): void {
  const slides = host.querySelectorAll('svg[data-marpit-svg]');
  if (!slides.length) return;
  const nav = document.querySelector('.deck-nav');
  const count = nav?.querySelector('[data-count]');
  let at = 0;

  const show = (n: number): void => {
    at = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((slide, i) => slide.classList.toggle('current', i === at));
    if (count) count.textContent = `${at + 1} / ${slides.length}`;
    const want = `#${at + 1}`;
    if (location.hash !== want) history.replaceState(null, '', want);
  };

  const fromHash = (): number => (Number.parseInt(location.hash.slice(1), 10) || 1) - 1;

  if (nav instanceof HTMLElement) {
    nav.hidden = false;
    nav.querySelector('[data-prev]')?.addEventListener('click', () => show(at - 1));
    nav.querySelector('[data-next]')?.addEventListener('click', () => show(at + 1));
  }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ') show(at + 1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') show(at - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else return;
    e.preventDefault();
  });
  window.addEventListener('hashchange', () => show(fromHash()));

  show(fromHash());
}

function content(): Element | null {
  return document.getElementById('content');
}

if (kind && raw) {
  if (kind === 'code') {
    withText(raw, (text) => {
      const el = content();
      if (el) renderCode(el, text, decodeURIComponent(location.pathname.split('/').pop() ?? ''));
    });
  }

  if (kind === 'md') {
    withText(raw, (text) => {
      const el = content();
      if (el) renderMarkdown(el, text);
    });
  }

  if (kind === 'slides') {
    /* render.js fetches the theme rather than linking it, because Marpit scopes
       it to the slide sections; a stylesheet link would leak bare `section`
       rules onto the rest of the page. */
    const themeCss = fetch('/vendor/marp/nt-marp.css')
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '');

    withText(raw, (text) => {
      void themeCss.then((css) => {
        const host = content();
        if (!host) return;
        renderDeck(host, text, css);
        deck(host);
      });
    });
  }
}
