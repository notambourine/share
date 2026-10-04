/**
 * Clients and prompts, in R2 because this repo is public and both name clients.
 * Edited on /admin/config; read by the shipped route.
 *
 *   _config/clients/<slug>.json          {label, repos}
 *   _config/prompts/<scope>/<id>.json    {kind, applies, text}
 *
 * A scope is a client slug or `_system`, which every client inherits.
 */

import type { Env } from '../lib/types';
import type { JsonObject } from '../lib/json';
import { parseObject, textAt, textsAt } from '../lib/json';
import { isValidSpace } from '../lib/keys';
import { listAll } from '../lib/r2';

export const CONFIG_PREFIX = '_config/';
export const SYSTEM_SCOPE = '_system';

/** The two shapes a shipped report takes, each one existing generation. */
export const FORMATS = [
  { key: 'agenda', label: 'agenda', generation: 'agenda' },
  { key: 'slides', label: 'slides', generation: 'deck' },
] as const;

export type FormatKey = (typeof FORMATS)[number]['key'];

export function isFormatKey(s: string): s is FormatKey {
  return FORMATS.some((f) => f.key === s);
}

export interface Client {
  slug: string;
  label: string;
  /** `owner/name`. */
  repos: string[];
}

export type PromptKind = 'instruction' | 'example';

export interface Prompt {
  scope: string;
  id: string;
  kind: PromptKind;
  /** Formats it feeds; empty means every format. */
  applies: FormatKey[];
  text: string;
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PROMPT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const isRepo = (s: string): boolean => REPO.test(s);
export const isPromptId = (s: string): boolean => PROMPT_ID.test(s);
export const isScope = (s: string): boolean => s === SYSTEM_SCOPE || isValidSpace(s);

const clientKey = (slug: string) => `${CONFIG_PREFIX}clients/${slug}.json`;
const promptKey = (scope: string, id: string) => `${CONFIG_PREFIX}prompts/${scope}/${id}.json`;

function decodeClient(slug: string, record: JsonObject | null): Client | null {
  if (!record) return null;
  return {
    slug,
    label: textAt(record, 'label') || slug,
    repos: textsAt(record, 'repos').filter(isRepo),
  };
}

function decodePrompt(scope: string, id: string, record: JsonObject | null): Prompt | null {
  const text = record && textAt(record, 'text');
  if (!record || !text) return null;
  return {
    scope, id, text,
    kind: textAt(record, 'kind') === 'example' ? 'example' : 'instruction',
    applies: textsAt(record, 'applies').filter(isFormatKey),
  };
}

async function readJson(env: Env, key: string): Promise<JsonObject | null> {
  const obj = await env.BUCKET.get(key);
  return obj ? parseObject(await obj.text()) : null;
}

/** The last path segment without `.json`. */
const leaf = (key: string): string => key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/, '');

export async function readClient(env: Env, slug: string): Promise<Client | null> {
  return decodeClient(slug, await readJson(env, clientKey(slug)));
}

export async function listClients(env: Env): Promise<Client[]> {
  const rows = await listAll(env, `${CONFIG_PREFIX}clients/`);
  const out: Client[] = [];
  for (const { key } of rows) {
    const c = await readClient(env, leaf(key));
    if (c) out.push(c);
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function writeClient(env: Env, client: Client): Promise<void> {
  await env.BUCKET.put(clientKey(client.slug), JSON.stringify({ label: client.label, repos: client.repos }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function deleteClient(env: Env, slug: string): Promise<void> {
  await env.BUCKET.delete([clientKey(slug)]);
}

/** Every prompt under `scope`, by id. */
export async function listPrompts(env: Env, scope: string): Promise<Prompt[]> {
  const rows = await listAll(env, `${CONFIG_PREFIX}prompts/${scope}/`);
  const out: Prompt[] = [];
  for (const { key } of rows) {
    const id = leaf(key);
    const p = decodePrompt(scope, id, await readJson(env, key));
    if (p) out.push(p);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function writePrompt(env: Env, p: Prompt): Promise<void> {
  await env.BUCKET.put(promptKey(p.scope, p.id), JSON.stringify({ kind: p.kind, applies: p.applies, text: p.text }), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function deletePrompt(env: Env, scope: string, id: string): Promise<void> {
  await env.BUCKET.delete([promptKey(scope, id)]);
}

/**
 * What a run adds to the system message, in order: system instructions, client
 * instructions, then every example, each example fenced so the model reads it
 * as a target shape rather than as facts.
 */
export async function instructionsFor(env: Env, slug: string, format: FormatKey): Promise<string[]> {
  const all = [...await listPrompts(env, SYSTEM_SCOPE), ...await listPrompts(env, slug)]
    .filter((p) => p.applies.length === 0 || p.applies.includes(format));
  return [
    ...all.filter((p) => p.kind === 'instruction').map((p) => p.text),
    ...all.filter((p) => p.kind === 'example').map((p) =>
      `<example>\nThe shape to match. Its facts are not this client's; never copy them.\n${p.text}\n</example>`),
  ];
}
