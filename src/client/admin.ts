/* Working-page behavior. The `?c=` token lives in location.search and JS memory
   only (never a cookie, never in the markup); every write re-reads it here.
   The Worker serves this page only behind a live token, so a missing c= means
   a stale tab - lock straight away.

   Nothing polls. The tiles are real anchors, the generate control is a real form
   posting into a new tab, and the Worker does the work inline on that request -
   so a cmd+clicked tab holds until the bytes land. The only fetches here are the
   two writes that have nothing to open: the TTL chips and delete. */

import { parseObject, textAt, numberAt } from '../lib/json';
import type { JsonObject } from '../lib/json';
import { now } from '../lib/clock';

let c = new URLSearchParams(location.search).get('c');
const actions = document.getElementById('actions');
const found = document.querySelector('[data-genform]');
const genform = found instanceof HTMLFormElement ? found : null;

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
  /* Where the generate form posts. Set here rather than rendered, because the
     action carries the token and the token appears nowhere in the markup. */
  function pointForm(): void {
    if (genform) genform.action = `${location.pathname}generate?c=${c}`;
  }
  pointForm();

  function adopt(fresh: string, freshExp: number): void {
    c = fresh;
    exp = freshExp;
    history.replaceState(null, '', `${location.pathname}?c=${fresh}`);
    pointForm();
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

  /* Generation is the page's one form, submitting into a new tab. The browser
     holds that tab through the model call and the route answers 303 to the
     version it wrote, so nothing here waits on a result, reports one, or polls.
     What is left is the token, the empty-pick guard, and swallowing a
     double-click. */
  const state = document.querySelector('[data-genstate]');

  function say(text: string): void {
    if (state) state.textContent = text;
  }

  if (genform) {
    const submits = genform.querySelectorAll('button[type="submit"]');
    const arm = (on: boolean): void => {
      for (const b of submits) {
        if (b instanceof HTMLButtonElement) b.disabled = !on;
      }
    };
    genform.addEventListener('submit', (e) => {
      if (genform.querySelectorAll('input[name="sources"]:checked').length === 0) {
        e.preventDefault();
        say('Tick what feeds it first.');
        return;
      }
      say('Generating in a new tab. This takes a few seconds.');
      /* Deferred a tick, not disabled inline: a submitter disabled inside its own
         submit handler is dropped from the entry list, so the POST would arrive
         with no name at all. */
      setTimeout(() => arm(false), 0);
      setTimeout(() => arm(true), 2000);
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
