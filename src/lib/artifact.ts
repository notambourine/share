/**
 * What a share holds, gathered once for the two representations of its index
 * page: the HTML a recipient reads and the JSON an agent reads. Both come off
 * this one model, so a link the page shows and a path the JSON names cannot
 * disagree.
 *
 * No credential. The overflow verdict is public here, deliberately reversing the
 * old status route's rule that "which slides clip is sender-only material": an
 * external agent reads the verdict off this page and re-generates, and the index
 * already shows the deck those slides are in.
 *
 * Uploads come from meta.json; generations and renders are both discovered by
 * listing, so nothing on this page depends on a manifest a concurrent write
 * could have clobbered.
 */

import type { Env, Meta, MetaFile } from './types';
import { listGenerated } from './r2';
import type { RenderedKey } from './exportPath';
import {
  baseOf, derivedPrefix, formatsFor, parseCheckKey, parseDerivedKey,
  renderedKey, stampOf, stemOf,
} from './exportPath';
import { type SlideCheck, decodeSlideCheck } from './pdf';

export type IndexFile = {
  path: string;
  size: number;
  /** The epoch this file was generated under, null when it was uploaded. */
  stamp: number | null;
  /** Export spellings this file answers to, e.g. `deck.1712.pdf`. */
  exports: string[];
};

/** One generated document and every version of it, newest first. */
export type IndexGeneration = {
  /** The bare name a reader hands over: `deck`, which resolves to the newest. */
  name: string;
  versions: IndexFile[];
};

export type IndexRender = {
  /** The file it was rendered from, stamp included. */
  source: string;
  /** The URL path that serves these bytes, e.g. `deck.1712.pdf`. */
  path: string;
  /** Which mode landed it, from the readiness vocabulary. */
  key: RenderedKey;
  /** The slides render's verdict, when one was measured. */
  check: SlideCheck | null;
};

export type ArtifactIndex = {
  space: string;
  hash: string;
  createdAt: number;
  /** Epoch seconds, null = never expires. */
  expiresAt: number | null;
  /** Files that arrived by upload, in upload order. */
  uploads: IndexFile[];
  generations: IndexGeneration[];
  /** Renders already stored, so a link on this page is a link that answers now. */
  renders: IndexRender[];
};

/** An upload reports no stamp whatever it is named: which side of the split a
    file sits on is settled by meta.files, never guessed off the filename. */
function indexFile(file: MetaFile, generated: boolean): IndexFile {
  const stem = stemOf(file.path);
  return {
    path: file.path,
    size: file.size,
    stamp: generated ? stampOf(file.path) : null,
    exports: formatsFor(file.path).map((spec) => `${stem}${spec.suffix}`),
  };
}

/** Newest stamp first, so the version list reads top-down as the history. */
function byStampDesc(a: IndexFile, b: IndexFile): number {
  return (b.stamp ?? 0) - (a.stamp ?? 0);
}

/**
 * The stored renders under this hash, plus each slides verdict. Two passes: the
 * listing is one call, and only the check objects need their bytes read.
 */
async function readRenders(env: Env, meta: Meta): Promise<IndexRender[]> {
  const prefix = derivedPrefix(meta.space, meta.hash);
  const renders: IndexRender[] = [];
  const checks = new Map<string, string>();
  for (const { key } of (await env.BUCKET.list({ prefix })).objects) {
    const rest = key.slice(prefix.length);
    const judged = parseCheckKey(rest);
    if (judged !== null) {
      checks.set(judged, key);
      continue;
    }
    const parsed = parseDerivedKey(rest);
    if (!parsed) continue;
    renders.push({
      source: parsed.source,
      path: `${stemOf(parsed.source)}.${parsed.ext}`,
      key: renderedKey(parsed.mode, parsed.ext),
      check: null,
    });
  }
  for (const render of renders) {
    const key = checks.get(render.source);
    // Only a slides render is measured, so only that one can carry a verdict.
    if (!key || render.key !== 'slides.pdf') continue;
    const obj = await env.BUCKET.get(key);
    if (obj) render.check = decodeSlideCheck(await obj.text());
  }
  renders.sort((a, b) => a.path.localeCompare(b.path));
  return renders;
}

export async function buildIndex(env: Env, meta: Meta): Promise<ArtifactIndex> {
  const uploads = meta.files.map((f) => indexFile(f, false));
  const generated = new Map<string, IndexFile[]>();
  for (const file of await listGenerated(env, meta)) {
    const name = baseOf(file.path);
    const entry = indexFile(file, true);
    const versions = generated.get(name);
    if (versions) versions.push(entry);
    else generated.set(name, [entry]);
  }

  const generations: IndexGeneration[] = [...generated].map(([name, versions]) => ({
    name,
    versions: versions.sort(byStampDesc),
  }));

  return {
    space: meta.space,
    hash: meta.hash,
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    uploads,
    generations,
    renders: await readRenders(env, meta),
  };
}
