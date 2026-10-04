import type { Env } from '../lib/types';
import { authorize } from '../lib/auth';
import { isValidSpace } from '../lib/keys';
import { ADMIN_CSP, htmlResponse, jsonResponse, seeOther, wantsJson } from '../lib/http';
import { now } from '../lib/clock';
import { noticeShell } from '../render/shell';
import { configShell, shippedShell } from '../render/admin';
import type { Prompt } from '../shipped/config';
import {
  SYSTEM_SCOPE, deleteClient, deletePrompt, isFormatKey, isPromptId, isRepo, isScope,
  listClients, listPrompts, readClient, writeClient, writePrompt,
} from '../shipped/config';
import { isWindowKey, windowSpan } from '../shipped/window';
import { runShipped } from '../shipped/run';
import { MODELS, modelFor } from '../transforms/prompt';

/** A form entry is a string or a File; only the string half carries a value. */
function isText(value: File | string): value is string {
  return typeof value === 'string';
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return v !== null && isText(v) ? v.trim() : '';
}

const page = (html: string): Response =>
  htmlResponse(html, 200, { 'content-security-policy': ADMIN_CSP, 'cache-control': 'no-store' });

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** GET /admin/shipped */
export async function shippedPage(request: Request, env: Env): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  return page(shippedShell(await listClients(env)));
}

/**
 * POST /admin/shipped: {client, window, format} as a form. The page submits it
 * into a new tab, so that tab holds through GitHub and the model call and the
 * 303 lands it on the document. The CLI asks for JSON instead.
 */
export async function shippedRun(request: Request, env: Env): Promise<Response> {
  const json = wantsJson(request);
  const gate = await authorize(request, env, json ? 'json' : 'text');
  if (gate instanceof Response) return gate;
  const refuse = (status: number, error: string) =>
    json ? jsonResponse({ error }, status) : htmlResponse(noticeShell('Nothing shipped report', error), status);

  const ai = env.AI;
  if (!ai) return refuse(503, 'generation unavailable: no AI binding');
  const form = await readForm(request);
  if (!form) return refuse(400, 'expected a form body {client, window, format}');
  const slug = field(form, 'client');
  const windowKey = field(form, 'window');
  const format = field(form, 'format');
  if (!isWindowKey(windowKey)) return refuse(400, 'window is one of 24h, 7d, 30d, month');
  if (!isFormatKey(format)) return refuse(400, 'format is agenda or slides');
  const model = modelFor(field(form, 'model'));
  if (!model) return refuse(400, `unknown model (${MODELS.map((m) => m.id).join(', ')})`);
  const client = isValidSpace(slug) ? await readClient(env, slug) : null;
  if (!client) return refuse(404, `no client ${slug}; add it at /admin/config`);

  const t = now();
  const out = await runShipped({ env, ai, client, span: windowSpan(windowKey, t), format, model, uploader: gate.email, t });
  if (!out.ok) return refuse(out.status, out.error);

  const origin = new URL(request.url).origin;
  const doc = `/${out.space}/${out.hash}/${encodeURI(out.path)}`;
  if (!json) return seeOther(doc);
  return jsonResponse({
    url: `${origin}${doc}`,
    pdf: `${origin}${doc.replace(/\.md$/, '.pdf')}`,
    digest: `${origin}/${out.space}/${out.hash}/${encodeURI(out.source)}`,
    adminUrl: `${origin}/admin/${out.space}/${out.hash}/`,
    empty: out.empty,
  }, 201);
}

/** GET /admin/config */
export async function configPage(request: Request, env: Env): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  const clients = await listClients(env);
  const prompts = new Map<string, Prompt[]>();
  for (const scope of [SYSTEM_SCOPE, ...clients.map((c) => c.slug)]) {
    prompts.set(scope, await listPrompts(env, scope));
  }
  return page(configShell({ clients, prompts }));
}

const backToConfig = (): Response => seeOther('/admin/config');
const bad = (message: string): Response => htmlResponse(noticeShell('Not saved', message), 400);

/** POST /admin/config/client: save or delete one client. */
export async function configClient(request: Request, env: Env): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  const form = await readForm(request);
  if (!form) return bad('expected a form body');
  const slug = field(form, 'slug');
  if (!isValidSpace(slug)) return bad(`${slug} is not a usable slug: lowercase letters, digits, dashes`);
  if (field(form, 'action') === 'delete') {
    await deleteClient(env, slug);
    return backToConfig();
  }
  const repos = field(form, 'repos').split(/\s+/).filter(Boolean);
  const wrong = repos.filter((r) => !isRepo(r));
  if (wrong.length) return bad(`not owner/name: ${wrong.join(', ')}`);
  await writeClient(env, { slug, label: field(form, 'label') || slug, repos });
  return backToConfig();
}

/** POST /admin/config/prompt: save or delete one prompt. */
export async function configPrompt(request: Request, env: Env): Promise<Response> {
  const gate = await authorize(request, env, 'text');
  if (gate instanceof Response) return gate;
  const form = await readForm(request);
  if (!form) return bad('expected a form body');
  const scope = field(form, 'scope');
  const id = field(form, 'id');
  if (!isScope(scope)) return bad(`no such scope: ${scope}`);
  if (!isPromptId(id)) return bad(`${id} is not a usable id: lowercase letters, digits, dashes`);
  if (field(form, 'action') === 'delete') {
    await deletePrompt(env, scope, id);
    return backToConfig();
  }
  const text = field(form, 'text');
  if (!text) return bad('a prompt needs text');
  await writePrompt(env, {
    scope, id, text,
    kind: field(form, 'kind') === 'example' ? 'example' : 'instruction',
    applies: form.getAll('applies').filter(isText).filter(isFormatKey),
  });
  return backToConfig();
}
