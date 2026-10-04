/* Working-page behavior. Access guards `/admin/*`, so this page carries no
   credential; a write that answers 401 means the SSO session lapsed, and a
   reload signs back in.

   Nothing polls. The tiles are real anchors, the generate control is a real form
   posting into a new tab, and the Worker does the work inline on that request -
   so a cmd+clicked tab holds until the bytes land. The only fetches here are the
   two writes that have nothing to open: the TTL chips and delete. */

import { parseObject, textAt } from '../lib/json';
import type { JsonObject } from '../lib/json';

const actions = document.getElementById('actions');
const found = document.querySelector('[data-genform]');
const genform = found instanceof HTMLFormElement ? found : null;

async function send(url: string, init?: RequestInit): Promise<JsonObject | null> {
  const r = await fetch(url, init);
  if (r.status === 401) { location.reload(); return null; }
  const body = parseObject(await r.text());
  return r.ok ? body : null;
}

if (actions) {
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
      void send(`${location.pathname}config`, {
        method: 'POST',
        body: JSON.stringify({ ttl: chip.dataset.ttl }),
      }).then((out) => {
        if (!out) return;
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
     What is left is the empty-pick guard and swallowing a double-click. */
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
    void fetch(location.pathname, { method: 'DELETE' }).then((r) => {
      if (r.status === 401) { location.reload(); return; }
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
