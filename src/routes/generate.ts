import type { Env, Meta, MetaFile } from '../lib/types';
import { adminToken } from './admin';
import { readMeta, readPayload, writeMeta, isExpired, payloadKey } from '../lib/r2';
import { contentTypeFor } from '../lib/keys';
import { parseObject, textAt, textsAt } from '../lib/json';
import { jsonResponse } from '../lib/http';
import type { TransformSource } from '../transforms/prompt';
import { GENERATIONS, MAX_TRANSFORM_BYTES, promptFor, runTransform, transformable } from '../transforms';

interface GenerateBody {
  name: string | null;
  sources: string[];
}

function decodeBody(text: string): GenerateBody | null {
  const record = parseObject(text);
  if (!record) return null;
  return { name: textAt(record, 'name'), sources: textsAt(record, 'sources') };
}

/**
 * POST /<space>/<hash>/generate?c=<token>: many sources in, one document out.
 *
 * The output lands as `<name>.<epoch>.md` beside the sources it came from and
 * joins `meta.files`, so the bare `<name>.md` follows the newest stamp and every
 * older version keeps its own URL. Nothing is overwritten, which is what makes
 * re-generating safe on a link already handed over.
 */
export async function generate(request: Request, env: Env, space: string, hash: string): Promise<Response> {
  const admin = await adminToken(request, env, space, hash);
  if (admin instanceof Response) return admin;
  const { t } = admin;

  const ai = env.AI;
  if (!ai) return jsonResponse({ error: 'generation unavailable: no AI binding' }, 503);

  const body = decodeBody(await request.text());
  if (!body) return jsonResponse({ error: 'expected JSON body {name, sources}' }, 400);
  const { name, sources } = body;
  if (!name || promptFor(name) === undefined) {
    return jsonResponse({ error: `unknown generation (${GENERATIONS.map((g) => g.name).join(', ')})` }, 400);
  }
  if (sources.length === 0) return jsonResponse({ error: 'tick at least one file' }, 400);

  const meta = await readMeta(env, space, hash);
  if (!meta || isExpired(meta, t)) return jsonResponse({ error: 'no such artifact' }, 404);

  /* The caller's order, so the composed document reads in the order they ticked
     the files, and only files this share holds. */
  const picked: MetaFile[] = [];
  for (const path of sources) {
    const file = meta.files.find((f) => f.path === path);
    if (!file) return jsonResponse({ error: `no such file: ${path}` }, 400);
    if (!transformable(path)) return jsonResponse({ error: `not text: ${path}` }, 400);
    picked.push(file);
  }

  /* Per run, not per file: a git-log dump plus notes will hit it. Refused with
     the count and the files rather than truncated - a quiet truncation produces
     a confidently wrong deck. */
  const bytes = picked.reduce((n, f) => n + f.size, 0);
  if (bytes > MAX_TRANSFORM_BYTES) {
    return jsonResponse({
      error: `too much text to generate from: ${bytes} bytes over ${MAX_TRANSFORM_BYTES}`,
      files: picked.map((f) => f.path),
    }, 413);
  }

  const texts: TransformSource[] = [];
  for (const file of picked) {
    const text = await readPayload(env, space, hash, file.path);
    if (text === null) return jsonResponse({ error: `could not read ${file.path}` }, 404);
    texts.push({ path: file.path, text });
  }

  const out = await runTransform(ai, name, texts);
  if (out === null) return jsonResponse({ error: 'the model call failed; try again' }, 502);

  const path = `${name}.${t}.md`;
  const blob = `${out}\n`;
  await env.BUCKET.put(payloadKey(space, hash, path), blob, {
    httpMetadata: { contentType: contentTypeFor(path) },
  });
  const file: MetaFile = { path, size: new TextEncoder().encode(blob).byteLength, type: contentTypeFor(path) };
  const updated: Meta = { ...meta, files: [...meta.files, file] };
  await writeMeta(env, updated);

  return jsonResponse({ path, size: file.size, bare: `${name}.md` }, 201);
}
