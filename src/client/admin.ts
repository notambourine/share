/* Admin page behavior. The `?c=` token lives in location.search and JS memory
   only (never a cookie, never in the markup); every write re-reads it here.
   The Worker serves this page only behind a live token, so a missing c= means
   a stale tab - lock straight away. */

import { parseObject, textAt, textsAt, numberAt, recordsAt, numbersAt, isJsonObject } from '../lib/json';
import type { JsonObject } from '../lib/json';

let c = new URLSearchParams(location.search).get('c');
const actions = document.getElementById('actions');

let pollTimer: ReturnType<typeof setInterval> | null = null;

function stopPoll(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
  // A spinner that outlives the poll would lie; leave the overflow chips.
  for (const st of document.querySelectorAll('.tstate.gen')) {
    st.className = 'tstate';
    st.textContent = '';
  }
}

function lock(): void {
  document.body.classList.add('locked');
  stopPoll();
}

/** Every write answers through this, so an expired token locks the tab once. */
async function send(url: string, init?: RequestInit): Promise<JsonObject | null> {
  const r = await fetch(url, init);
  if (r.status === 401) { lock(); return null; }
  if (!r.ok) return null;
  return parseObject(await r.text());
}

function expOf(token: string): number {
  /* exp rides inside the token (v<n>.<exp>.<sig>). */
  return Number.parseInt(token.split('.')[1] ?? '', 10) || 0;
}

if (!c || !actions) {
  lock();
} else {
  const token = c;
  /* Countdown: zero degrades to the locked fs-index; the server enforces the
     same clock. */
  const badge = document.querySelector('[data-countdown]');
  let exp = expOf(token);

  function tick(): void {
    const left = Math.max(0, exp - Math.floor(Date.now() / 1000));
    const m = Math.floor(left / 60);
    const s = `0${left % 60}`.slice(-2);
    if (badge) badge.textContent = `this link: ${m}:${s} left`;
    if (!left) lock();
  }
  tick();
  setInterval(tick, 1000);

  /* Sliding window: each config write answers a fresh token; adopt it so the
     address bar, the next write, and the countdown all agree. */
  function adopt(fresh: string): void {
    c = fresh;
    exp = expOf(fresh);
    history.replaceState(null, '', `${location.pathname}?c=${fresh}`);
    tick();
  }

  function copied(el: Element, done?: string, redo?: string): void {
    el.classList.add('did');
    if (done) el.textContent = done;
    setTimeout(() => {
      el.classList.remove('did');
      if (redo) el.textContent = redo;
    }, 1200);
  }

  const copylink = document.querySelector('[data-copylink]');
  if (copylink instanceof HTMLElement) {
    copylink.addEventListener('click', () => {
      void navigator.clipboard.writeText(copylink.dataset.url ?? '').then(() => {
        copied(copylink, 'copied', 'copy link');
      });
    });
  }

  /* The corner icon copies; the card itself opens. Keep the two apart. */
  for (const b of document.querySelectorAll('[data-copy-href]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const anchor = b.closest('a');
      if (!anchor) return;
      void navigator.clipboard.writeText(anchor.href).then(() => copied(b));
    });
  }

  function expText(at: number | null): string {
    if (at === null) return 'never expires';
    const left = at - Math.floor(Date.now() / 1000);
    if (left >= 86400) return `expires in ${Math.ceil(left / 86400)}d`;
    if (left >= 3600) return `expires in ${Math.ceil(left / 3600)}h`;
    return `expires in ${Math.max(1, Math.ceil(left / 60))}m`;
  }

  for (const chip of document.querySelectorAll('[data-ttl]')) {
    chip.addEventListener('click', () => {
      if (!(chip instanceof HTMLElement)) return;
      void send(`${location.pathname}config?c=${c}`, {
        method: 'POST',
        body: JSON.stringify({ ttl: chip.dataset.ttl }),
      }).then((out) => {
        if (!out) return;
        const fresh = textAt(out, 'c');
        if (fresh) adopt(fresh);
        for (const o of document.querySelectorAll('[data-ttl]')) {
          o.setAttribute('aria-pressed', String(o === chip));
        }
        const el = document.querySelector('[data-exp]');
        if (el) el.textContent = expText(numberAt(out, 'expiresAt'));
      });
    });
  }

  /* Status poll: the route is pure reads, so polling can never spend a browser
     minute. 3s while any awaited render is missing; stops when everything landed
     and each slides source has its check, on 401, or at 2 minutes. Ready is
     silent - only generating and overflow get chrome. */
  const awaited = document.querySelectorAll('[data-await]');
  let polled = 0;

  /* Nothing prerenders, so every awaited tile is click-to-generate: until clicked
     it reads "click to generate" and never holds the poll open. */
  const requested = new Set<Element>();

  interface Source {
    rendered: string[];
    overflow: number[] | null;
  }

  /** A source row the status route answered with. An unreadable row is dropped,
      so a partial answer paints what it can rather than nothing. */
  function decodeSources(out: JsonObject): Map<string, Source> {
    const rows = recordsAt(out, 'sources') ?? [];
    const byPath = new Map<string, Source>();
    for (const row of rows) {
      const path = textAt(row, 'path');
      if (path === null) continue;
      const check = row['check'];
      byPath.set(path, {
        rendered: textsAt(row, 'rendered'),
        overflow: isJsonObject(check) ? numbersAt(check, 'overflow') : null,
      });
    }
    return byPath;
  }

  function paint(byPath: Map<string, Source>): boolean {
    let settled = true;
    for (const tile of awaited) {
      if (!(tile instanceof HTMLElement)) continue;
      const s = byPath.get(tile.dataset.src ?? '');
      const st = tile.querySelector('.tstate');
      const key = tile.dataset.await;
      if (!s || !st || !key) continue;
      const ready = s.rendered.includes(key);
      const slides = key.startsWith('slides.');
      if (slides && s.overflow !== null && s.overflow.length) {
        const n = s.overflow;
        st.className = 'tstate err';
        st.textContent = n.length === 1
          ? `slide ${n[0]} overflows`
          : `slides ${n.join(', ')} overflow`;
      } else if (ready) {
        st.className = 'tstate';
        st.textContent = '';
      } else if (tile.dataset.gen && !requested.has(tile)) {
        st.className = 'tstate todo';
        st.textContent = 'click to generate';
      } else {
        st.className = 'tstate gen';
        st.textContent = 'generating';
        settled = false;
      }
      if (slides && s.overflow === null) settled = false;
    }
    return settled;
  }

  function poll(): void {
    void send(`${location.pathname}status?c=${c}`).then((out) => {
      // pollTimer gone = capped or settled while this answer was in flight.
      if (out && pollTimer && paint(decodeSources(out))) stopPoll();
    }).catch(() => { /* a dropped poll retries on the next tick */ });
    polled += 3000;
    if (polled > 120000) stopPoll();
  }

  if (awaited.length) { pollTimer = setInterval(poll, 3000); poll(); }

  /* The tab's own GET fires the render (the tile stays a real anchor); here
     only mark it pending and wake the poll back up. */
  for (const tile of awaited) {
    if (!(tile instanceof HTMLElement) || !tile.dataset.gen) continue;
    tile.addEventListener('click', () => {
      requested.add(tile);
      const st = tile.querySelector('.tstate');
      if (st) { st.className = 'tstate gen'; st.textContent = 'generating'; }
      polled = 0;
      if (!pollTimer) pollTimer = setInterval(poll, 3000);
    });
  }

  /* Delete: the confirm replaces the whole action row, so copy is gone while
     it is armed. DELETE, never GET - link scanners prefetch. */
  const arm = document.querySelector('[data-arm]');
  const disarm = document.querySelector('[data-disarm]');
  const fire = document.querySelector('[data-fire]');
  arm?.addEventListener('click', () => actions.classList.add('arming'));
  disarm?.addEventListener('click', () => actions.classList.remove('arming'));
  fire?.addEventListener('click', () => {
    void fetch(`${location.pathname}?c=${c}`, { method: 'DELETE' }).then((r) => {
      if (r.status === 401) { lock(); return; }
      if (r.status !== 204 && r.status !== 404) return;
      /* Built rather than assigned as markup: the row is fixed copy, so there is
         no reason for this file to hold a second HTML string. */
      const note = document.createElement('p');
      note.className = 'confirmtext trashed';
      note.textContent = 'Moved to trash. The link dies within 10 minutes and purges in 90 days.';
      actions.replaceChildren(note);
    });
  });
}
