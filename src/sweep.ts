import type { Env } from './lib/types';
import { TRASH_PREFIX } from './lib/types';
import { readMeta, isExpired, moveToTrash } from './lib/r2';
import { now } from './lib/http';

/**
 * Nightly cron: an R2 lifecycle rule cannot read a date out of meta.json, so
 * this walks every meta record and moves expired uploads to _trash/, where the
 * one lifecycle rule purges them after 90 days.
 */
export async function sweep(env: Env): Promise<{ scanned: number; trashed: number }> {
  const t = now();
  let scanned = 0;
  let trashed = 0;

  const spaces: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: '', delimiter: '/', cursor });
    for (const p of page.delimitedPrefixes) {
      if (p !== TRASH_PREFIX) spaces.push(p.replace(/\/$/, ''));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (const space of spaces) {
    let c: string | undefined;
    do {
      const page = await env.BUCKET.list({ prefix: `${space}/`, delimiter: '/', cursor: c });
      for (const p of page.delimitedPrefixes) {
        const hash = p.slice(space.length + 1).replace(/\/$/, '');
        const meta = await readMeta(env, space, hash);
        scanned++;
        if (meta && isExpired(meta, t)) {
          await moveToTrash(env, space, hash);
          trashed++;
        }
      }
      c = page.truncated ? page.cursor : undefined;
    } while (c);
  }

  return { scanned, trashed };
}
