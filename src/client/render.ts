/* The only script a shell loads. Every page arrives rendered from the Worker, so
   what is left here is the part that is actually interactive: the copy button and
   deck navigation. */

const copy = document.querySelector('[data-copy]');
if (copy) {
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(location.origin + location.pathname).then(() => {
      copy.textContent = 'copied';
      setTimeout(() => { copy.textContent = 'copy link'; }, 1500);
    });
  });
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

/* The slides are in the markup already, so their container is the whole signal -
   no data attribute to read and nothing to wait for. */
const host = document.querySelector('.deck');
if (host) deck(host);
