import type { Env, MetaFile } from '../lib/types';
import { adminToken } from './admin';
import { readMeta, readPayload, isExpired, payloadKey } from '../lib/r2';
import { contentTypeFor } from '../lib/keys';
import { parseObject, textAt, textsAt } from '../lib/json';
import { htmlResponse, jsonResponse, seeOther, wantsJson } from '../lib/http';
import { noticeShell } from '../render/shell';
import type { TransformSource } from '../transforms/prompt';
import { GENERATIONS, MAX_TRANSFORM_BYTES, promptFor, runTransform, transformable } from '../transforms';

interface GenerateBody {
  name: string | null;
  sources: string[];
}

function decodeJsonBody(text: string): GenerateBody | null {
  const record = parseObject(text);
  if (!record) return null;
  return { name: textAt(record, 'name'), sources: textsAt(record, 'sources') };
}

/** A form entry is a string or a File; only the string half can name a source. */
function isText(value: File | string): value is string {
  return typeof value === 'string';
}

/** The working page's form: one `name` off whichever submit button was pressed,
    one `sources` entry per ticked box, in the order the boxes are rendered. */
function decodeFormBody(form: FormData): GenerateBody {
  const name = form.get('name');
  return {
    name: name !== null && isText(name) ? name : null,
    sources: form.getAll('sources').filter(isText),
  };
}

function isFormPost(request: Request): boolean {
  const type = request.headers.get('content-type') ?? '';
  return type.startsWith('application/x-www-form-urlencoded')
    || type.startsWith('multipart/form-data');
}

/**
 * Two callers, so two answers. The working page submits a form, which is a
 * navigation: it gets a readable page or a redirect, because a tab cannot render
 * a JSON blob usefully. Everything else - an agent, the tests, curl - gets the
 * same facts as data.
 */
function refuse(request: Request, status: number, error: string, files?: string[]): Response {
  if (!isFormPost(request) || wantsJson(request)) {
    return jsonResponse({ error, ...(files && { files }) }, status);
  }
  return htmlResponse(noticeShell('Nothing generated', error), status);
}

/* Stamps are second-granularity, so two runs of one generation inside a single
   second would collide; step past a name already taken rather than overwrite it. */
async function freeStamp(
  env: Env, space: string, hash: string, name: string, t: number,
): Promise<string> {
  let stamp = t;
  while (await env.BUCKET.head(payloadKey(space, hash, `${name}.${stamp}.md`))) stamp += 1;
  return `${name}.${stamp}.md`;
}

/**
 * POST /<space>/<hash>/generate?c=<token>: many sources in, one document out.
 *
 * The document is the only thing this route writes. meta.json is not touched, so
 * two runs finishing at once cannot drop each other from a manifest; the index
 * page and the bare-name alias both find a generation by listing `f/`, the way
 * renders have always been found. Nothing is overwritten either, which is what
 * makes re-generating safe on a link already handed over.
 *
 * The working page submits a real form into a new tab, so that tab is what waits
 * on this request - it holds through the model call and the 303 lands it on the
 * version that was written. Nothing polls anywhere.
 */
export async function generate(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const admin = await adminToken(request, env, space, hash);
  if (admin instanceof Response) return admin;
  const { t } = admin;

  const ai = env.AI;
  if (!ai) return refuse(request, 503, 'generation unavailable: no AI binding');

  const body = isFormPost(request)
    ? decodeFormBody(await request.formData())
    : decodeJsonBody(await request.text());
  if (!body) return refuse(request, 400, 'expected JSON body {name, sources}');
  const { name, sources } = body;
  if (!name || promptFor(name) === undefined) {
    return refuse(request, 400, `unknown generation (${GENERATIONS.map((g) => g.name).join(', ')})`);
  }
  if (sources.length === 0) return refuse(request, 400, 'tick at least one file');

  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return refuse(request, 404, 'no such artifact');

  /* The order they arrived in, so the composed document reads the way the page
     listed the files. Only uploads: meta.files is the whole world here, because
     feeding a generation back in would compound one model's output into the next. */
  const picked: MetaFile[] = [];
  for (const path of sources) {
    const file = meta.files.find((f) => f.path === path);
    if (!file) return refuse(request, 400, `no such file: ${path}`);
    if (!transformable(path)) return refuse(request, 400, `not text: ${path}`);
    picked.push(file);
  }

  /* Per run, not per file: a git-log dump plus notes will hit it. Refused with
     the count and the files rather than truncated - a quiet truncation produces
     a confidently wrong deck. */
  const bytes = picked.reduce((n, f) => n + f.size, 0);
  if (bytes > MAX_TRANSFORM_BYTES) {
    return refuse(
      request, 413,
      `too much text to generate from: ${bytes} bytes over ${MAX_TRANSFORM_BYTES}`,
      picked.map((f) => f.path),
    );
  }

  const texts: TransformSource[] = [];
  for (const file of picked) {
    const text = await readPayload(env, space, hash, file.path);
    if (text === null) return refuse(request, 404, `could not read ${file.path}`);
    texts.push({ path: file.path, text });
  }

  const out = await runTransform(ai, name, texts);
  if (out === null) return refuse(request, 502, 'the model call failed; try again');

  const path = await freeStamp(env, space, hash, name, t);
  const blob = `${out}\n`;
  await env.BUCKET.put(payloadKey(space, hash, path), blob, {
    httpMetadata: { contentType: contentTypeFor(path) },
  });

  if (!isFormPost(request) || wantsJson(request)) {
    const size = new TextEncoder().encode(blob).byteLength;
    return jsonResponse({ path, size, bare: `${name}.md` }, 201);
  }
  return seeOther(encodeURI(path));
}
