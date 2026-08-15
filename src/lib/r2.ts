import type { Env, Meta } from './types';
import { TRASH_PREFIX } from './types';

export async function readMeta(env: Env, space: string, hash: string): Promise<Meta | null> {
  const obj = await env.BUCKET.get(`${space}/${hash}/meta.json`);
  if (!obj) return null;
  try {
    return await obj.json<Meta>();
  } catch {
    return null;
  }
}

export function isExpired(meta: Meta, nowSecs: number): boolean {
  if (meta.expiresAt !== null && nowSecs > meta.expiresAt) return true;
  if (meta.idleTtl !== null && nowSecs > meta.lastAccess + meta.idleTtl) return true;
  return false;
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
 * hide material for 30 days (the _trash/ lifecycle rule) but never destroy it.
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
