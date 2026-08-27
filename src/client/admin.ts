/* Working-page behavior. The `?c=` token lives in location.search and JS memory
   only (never a cookie, never in the markup); every write re-reads it here.
   The Worker serves this page only behind a live token, so a missing c= means
   a stale tab - lock straight away.

   Nothing polls. The tiles are real anchors and the Worker renders inline on the
   first GET, so a cmd+clicked tab holds until the bytes land; the only fetches
   here are the three writes. */

import { parseObject, textAt, numberAt } from '../lib/json';
import type { JsonObject } from '../lib/json';
import { now } from '../lib/clock';

let c = new URLSearchParams(location.search).get('c');
const actions = document.getElementById('actions');

function lock(): void {
  document.body.classList.add('locked');
}

/** Every write answers through this, so an expired token locks the tab once. */
async function send(url: string, init?: RequestInit): Promise<JsonObject | null> {
  const r = await fetch(url, init);
  if (r.status === 401) { lock(); return null; }
  const body = parseObject(await r.text());
  return r.ok ? body : null;
}

if (!c || !actions) {
  lock();
} else {
  /* Countdown: zero degrades to the locked panel; the server enforces the same
     clock. The exp is handed over as data rather than read out of the token -
     this file never takes a credential apart. */
  const badge = document.querySelector('[data-countdown]');
  let exp = badge instanceof HTMLElement ? Number(badge.dataset.exp) || 0 : 0;

  function tick(): void {
    const left = Math.max(0, exp - now());
    const m = Math.floor(left / 60);
    const s = `0${left % 60}`.slice(-2);
    if (badge) badge.textContent = `this link: ${m}:${s} left`;
    if (!left) lock();
  }
  tick();
  setInterval(tick, 1000);

  /* Sliding window: each config write answers a fresh token and the epoch it
     dies; adopt both so the address bar, the next write, and the countdown all
     agree. */
  function adopt(fresh: string, freshExp: number): void {
    c = fresh;
    exp = freshExp;
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

  for (const chip of document.querySelectorAll('[data-ttl]')) {
    chip.addEventListener('click', () => {
      if (!(chip instanceof HTMLElement)) return;
      void send(`${location.pathname}config?c=${c}`, {
        method: 'POST',
        body: JSON.stringify({ ttl: chip.dataset.ttl }),
      }).then((out) => {
        if (!out) return;
        const fresh = textAt(out, 'c');
        if (fresh) adopt(fresh, numberAt(out, 'exp') ?? 0);
        for (const o of document.querySelectorAll('[data-ttl]')) {
          o.setAttribute('aria-pressed', String(o === chip));
        }
        const el = document.querySelector('[data-exp]');
        const expiry = textAt(out, 'expiry');
        if (el && expiry) el.textContent = expiry;
      });
    });
  }

  /* Generation: the ticked files, in tick order, then one POST. The answer
     names the version that landed, which is a link the reader can open now -
     the page does not reload, because a stale c= in the address bar would. */
  const state = document.querySelector('[data-genstate]');
  const ticked: string[] = [];

  function say(text: string): void {
    if (state) state.textContent = text;
  }

  for (const box of document.querySelectorAll('[data-source]')) {
    if (!(box instanceof HTMLInputElement)) continue;
    box.addEventListener('change', () => {
      const at = ticked.indexOf(box.value);
      if (box.checked && at === -1) ticked.push(box.value);
      else if (!box.checked && at !== -1) ticked.splice(at, 1);
    });
  }

  for (const button of document.querySelectorAll('[data-generate]')) {
    if (!(button instanceof HTMLElement)) continue;
    button.addEventListener('click', () => {
      const name = button.dataset.generate ?? '';
      if (ticked.length === 0) {
        say('Tick at least one file first.');
        return;
      }
      say(`Generating the ${name}. This takes a few seconds.`);
      void send(`${location.pathname}generate?c=${c}`, {
        method: 'POST',
        body: JSON.stringify({ name, sources: ticked }),
      }).then((out) => {
        const path = out && textAt(out, 'path');
        if (!path) {
          say(`The ${name} did not generate. Try again, or tick less material.`);
          return;
        }
        say('');
        /* A real anchor, appended rather than assigned as markup, so the
           filename never crosses back through an HTML string. */
        const link = document.createElement('a');
        link.href = path;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = path;
        state?.replaceChildren(document.createTextNode('Ready: '), link);
      }).catch(() => {
        // A dropped POST must not leave "Generating" standing forever.
        say(`The ${name} did not generate. Try again.`);
      });
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
