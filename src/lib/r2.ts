import type { Env, Meta, MetaFile } from './types';
import { TRASH_PREFIX } from './types';
import type { JsonObject } from './json';
import { numberAt, parseObject, recordsAt, textAt } from './json';

function decodeFile(record: JsonObject): MetaFile | null {
  const path = textAt(record, 'path');
  const size = numberAt(record, 'size');
  const type = textAt(record, 'type');
  if (path === null || size === null || type === null) return null;
  // Absent on every upload that predates posters, and on every kind that has
  // no frame to cut, so a missing one is the norm rather than a bad record.
  const poster = textAt(record, 'poster');
  return { path, size, type, ...(poster !== null && { poster }) };
}

/**
 * meta.json is this Worker's own record, and it still gets decoded: a partial
 * write or an older field set would otherwise reach the router as a `Meta` that
 * lies about which files a share holds.
 */
export function decodeMeta(text: string): Meta | null {
  const record = parseObject(text);
  if (!record) return null;

  const space = textAt(record, 'space');
  const hash = textAt(record, 'hash');
  const uploader = textAt(record, 'uploader');
  const createdAt = numberAt(record, 'createdAt');
  const files = recordsAt(record, 'files');
  if (space === null || hash === null || uploader === null) return null;
  if (createdAt === null || files === null) return null;

  const decoded: MetaFile[] = [];
  for (const file of files) {
    const one = decodeFile(file);
    if (!one) return null;
    decoded.push(one);
  }

  return {
    space,
    hash,
    uploader,
    createdAt,
    expiresAt: numberAt(record, 'expiresAt'),
    files: decoded,
  };
}

export async function readMeta(env: Env, space: string, hash: string): Promise<Meta | null> {
  const obj = await env.BUCKET.get(`${space}/${hash}/meta.json`);
  if (!obj) return null;
  return decodeMeta(await obj.text());
}

export async function writeMeta(env: Env, meta: Meta): Promise<void> {
  await env.BUCKET.put(`${meta.space}/${meta.hash}/meta.json`, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** Where one uploaded file's bytes live. `f/` is the payload prefix, which is
    why normalizeUploadPath refuses an upload that claims that segment. */
export function payloadKey(space: string, hash: string, path: string): string {
  return `${space}/${hash}/f/${path}`;
}

export async function readPayload(
  env: Env, space: string, hash: string, path: string,
): Promise<string | null> {
  const obj = await env.BUCKET.get(payloadKey(space, hash, path));
  return obj ? obj.text() : null;
}

export function isExpired(meta: Meta, nowSecs: number): boolean {
  return meta.expiresAt !== null && nowSecs > meta.expiresAt;
}

export async function listAllKeys(env: Env, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, cursor });
    for (const o of page.objects) keys.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

/**
 * Soft delete: copy under _trash/ then delete originals. The upload token can
 * hide material for 90 days (the _trash/ lifecycle rule) but never destroy it.
 */
export async function moveToTrash(env: Env, space: string, hash: string): Promise<number> {
  const prefix = `${space}/${hash}/`;
  const keys = await listAllKeys(env, prefix);
  for (const key of keys) {
    const obj = await env.BUCKET.get(key);
    if (!obj) continue;
    await env.BUCKET.put(`${TRASH_PREFIX}${key}`, obj.body, {
      httpMetadata: obj.httpMetadata,
    });
  }
  // Delete after every copy landed, so a mid-move crash never loses bytes.
  for (let i = 0; i < keys.length; i += 100) {
    await env.BUCKET.delete(keys.slice(i, i + 100));
  }
  return keys.length;
}
