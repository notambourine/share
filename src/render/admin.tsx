/**
 * The two team pages under /admin/ beside the working page: "what shipped" and
 * the client and prompt config it reads. Plain forms posting to this origin;
 * the shipped form opens its result in a new tab, the way generate does.
 */

import type { Client, Prompt } from '../shipped/config';
import { FORMATS, SYSTEM_SCOPE } from '../shipped/config';
import { WINDOWS } from '../shipped/window';
import { layout, modelPicker } from './shell';

const BAR = <span class="pill pill-admin">admin</span>;

function nav(current: 'shipped' | 'config') {
  return (
    <p class="note">
      {current === 'shipped' ? <a href="/admin/config">clients and prompts</a> : <a href="/admin/shipped">what shipped</a>}
    </p>
  );
}

export function shippedShell(clients: Client[]): string {
  return layout({
    title: 'what shipped',
    bodyAttrs: { class: 'admin' },
    script: '/admin.js',
    bar: BAR,
    body: (
      <div class="admin-wrap">
        <div class="filehead"><h1>What shipped</h1></div>
        {nav('shipped')}
        {clients.length === 0 ? (
          <div class="panel form-stack">
            <p>No clients yet. Add one with its repos under <a href="/admin/config">clients and prompts</a>.</p>
          </div>
        ) : (
          <div class="form-stack">
            <form class="panel" method="post" action="/admin/shipped" target="_blank" rel="noopener">
              <label class="field">
                <span>client</span>
                <select name="client" required>
                  {clients.map((c) => <option value={c.slug}>{c.label}</option>)}
                </select>
              </label>
              <div class="field">
                <span>window</span>
                <div class="radios">
                  {WINDOWS.map((w, i) => (
                    <label><input type="radio" name="window" value={w.key} checked={i === 1} />{w.label}</label>
                  ))}
                </div>
              </div>
              {modelPicker()}
              <div class="chiprow">
                {FORMATS.map((f) => (
                  <button class="abtn abtn-primary" type="submit" name="format" value={f.key}>{f.label}</button>
                ))}
              </div>
              <p class="note">Reads merged pull requests and releases from the client's repos, then
                writes the agenda or slides into a new share. It opens in a new tab in under a minute.
                Swap the result's .md for .pdf to get a PDF; the share's working page generates the
                other format from the same digest.</p>
            </form>
          </div>
        )}
      </div>
    ),
  });
}

function appliesBoxes(p?: Prompt) {
  return (
    <div class="field">
      <span>used for</span>
      <div class="radios">
        {FORMATS.map((f) => (
          <label><input type="checkbox" name="applies" value={f.key} checked={p?.applies.includes(f.key) ?? false} />{f.label}</label>
        ))}
      </div>
      <small>Leave both unticked to use it for both.</small>
    </div>
  );
}

function kindSelect(p?: Prompt) {
  return (
    <label class="field">
      <span>kind</span>
      <select name="kind">
        <option value="instruction" selected={p?.kind !== 'example'}>instruction: a rule to follow</option>
        <option value="example" selected={p?.kind === 'example'}>example: a finished agenda or deck to imitate</option>
      </select>
    </label>
  );
}

function promptForm(p: Prompt) {
  return (
    <form class="panel" method="post" action="/admin/config/prompt">
      <p class="cardlabel">{p.id}</p>
      <input type="hidden" name="scope" value={p.scope} />
      <input type="hidden" name="id" value={p.id} />
      {kindSelect(p)}
      {appliesBoxes(p)}
      <label class="field"><span>text</span><textarea name="text" required>{p.text}</textarea></label>
      <div class="chiprow">
        <button class="abtn abtn-primary" type="submit" name="action" value="save">save</button>
        <button class="abtn abtn-ghost" type="submit" name="action" value="delete">delete</button>
      </div>
    </form>
  );
}

export interface ConfigView {
  clients: Client[];
  /** Keyed by scope: SYSTEM_SCOPE first, then each client slug. */
  prompts: Map<string, Prompt[]>;
}

export function configShell({ clients, prompts }: ConfigView): string {
  const scopes = [SYSTEM_SCOPE, ...clients.map((c) => c.slug)];
  const scopeLabel = (s: string) => (s === SYSTEM_SCOPE ? 'all clients' : clients.find((c) => c.slug === s)?.label ?? s);
  return layout({
    title: 'clients and prompts',
    bodyAttrs: { class: 'admin' },
    script: '/admin.js',
    bar: BAR,
    body: (
      <div class="admin-wrap">
        <div class="filehead"><h1>Clients and prompts</h1></div>
        {nav('config')}

        <section class="config-section">
          <h2>Clients</h2>
          <p class="note">Each client is a name plus the GitHub repos What shipped reads. The
            notambourine-velocity GitHub App must be installed on every repo listed.</p>
          <div class="form-stack">
            {clients.map((c) => (
              <form class="panel" method="post" action="/admin/config/client">
                <p class="cardlabel">{c.slug}</p>
                <input type="hidden" name="slug" value={c.slug} />
                <label class="field"><span>name</span><input name="label" value={c.label} /></label>
                <label class="field"><span>repos</span>
                  <textarea name="repos">{c.repos.join('\n')}</textarea>
                  <small>One owner/name per line.</small></label>
                <div class="chiprow">
                  <button class="abtn abtn-primary" type="submit" name="action" value="save">save</button>
                  <button class="abtn abtn-ghost" type="submit" name="action" value="delete">delete</button>
                </div>
              </form>
            ))}
            <form class="panel" method="post" action="/admin/config/client">
              <p class="cardlabel">add a client</p>
              <label class="field"><span>slug</span>
                <input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,31}" placeholder="acme" />
                <small>Lowercase letters, digits, and dashes. Fixed once saved.</small></label>
              <label class="field"><span>name</span>
                <input name="label" placeholder="Acme Corp" />
                <small>Shown in the client picker and on generated agendas and slides.</small></label>
              <label class="field"><span>repos</span>
                <textarea name="repos" placeholder={'acme/storefront\nacme/api'}></textarea>
                <small>One owner/name per line.</small></label>
              <div class="chiprow"><button class="abtn abtn-primary" type="submit" name="action" value="save">add client</button></div>
            </form>
          </div>
        </section>

        <section class="config-section">
          <h2>Prompts</h2>
          <p class="note">Optional. Each run uses the built-in rules, then prompts for all clients, then
            the client's own. Instructions are rules to follow. Examples are finished agendas or decks
            to imitate.</p>
          {scopes.map((scope) => (
            <div class="form-stack">
              <h3>{scopeLabel(scope)}</h3>
              {(prompts.get(scope) ?? []).length === 0 ? <p class="note">No prompts yet.</p> : (prompts.get(scope) ?? []).map(promptForm)}
            </div>
          ))}
          <div class="form-stack">
            <form class="panel" method="post" action="/admin/config/prompt">
              <p class="cardlabel">add a prompt</p>
              <label class="field"><span>client</span>
                <select name="scope">{scopes.map((s) => <option value={s}>{scopeLabel(s)}</option>)}</select></label>
              <label class="field"><span>id</span>
                <input name="id" required pattern="[a-z0-9][a-z0-9-]{0,47}" placeholder="tone" />
                <small>Lowercase letters, digits, and dashes. Saving with an id that already exists replaces that prompt.</small></label>
              {kindSelect()}
              {appliesBoxes()}
              <label class="field"><span>text</span><textarea name="text" required></textarea></label>
              <div class="chiprow"><button class="abtn abtn-primary" type="submit" name="action" value="save">add prompt</button></div>
            </form>
          </div>
        </section>
      </div>
    ),
  });
}
