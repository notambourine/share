/**
 * One "what shipped" run: read GitHub for a client's window, store the digest as
 * a new share's only upload, and generate the asked-for format beside it. The
 * digest stays, so the working page can re-generate from it in the other format.
 */

import type { AiRunner, Env, Meta } from '../lib/types';
import { DEFAULT_ARTIFACT_DAYS } from '../lib/types';
import { contentTypeFor, genSlug } from '../lib/keys';
import { payloadKey, writeMeta } from '../lib/r2';
import { appJwt, installationToken } from '../github/app';
import type { Shipped } from '../github/shipped';
import { digest, mergedPrs, releases } from '../github/shipped';
import { writeGeneration } from '../routes/generate';
import type { Client, FormatKey } from './config';
import { FORMATS, instructionsFor } from './config';
import type { Span } from './window';

export type ShippedResult =
  | { ok: true; space: string; hash: string; path: string; source: string; empty: boolean }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ShippedResult => ({ ok: false, status, error });

/** One installation token per owner: the App is installed per org. */
async function collect(env: Env, repos: string[], span: Span, t: number): Promise<Shipped | { error: string }> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return { error: 'GitHub App credentials are not configured' };
  const jwt = await appJwt({ id: env.GITHUB_APP_ID, key: env.GITHUB_APP_PRIVATE_KEY }, t);
  const byOwner = new Map<string, string[]>();
  for (const repo of repos) {
    const owner = repo.slice(0, repo.indexOf('/')).toLowerCase();
    byOwner.set(owner, [...byOwner.get(owner) ?? [], repo]);
  }
  const out: Shipped = { prs: [], releases: [] };
  for (const [owner, owned] of byOwner) {
    const token = await installationToken(jwt, owned[0]);
    if (!token) return { error: `the GitHub App is not installed on ${owner}` };
    out.prs.push(...await mergedPrs(token, owned, span.from, span.to));
    for (const repo of owned) out.releases.push(...await releases(token, repo, span.from, span.to));
  }
  return out;
}

export interface ShippedRun {
  env: Env;
  ai: AiRunner;
  client: Client;
  span: Span;
  format: FormatKey;
  uploader: string;
  t: number;
}

export async function runShipped(run: ShippedRun): Promise<ShippedResult> {
  const { env, ai, client, span, format, uploader, t } = run;
  if (client.repos.length === 0) return fail(400, `${client.label} has no repos configured`);

  let collected: Shipped | { error: string };
  try {
    collected = await collect(env, client.repos, span, t);
  } catch (err) {
    return fail(502, `GitHub did not answer: ${String(err)}`);
  }
  if ('error' in collected) return fail(503, collected.error);
  const shipped = collected;

  const source = `shipped-${span.key}.md`;
  const text = digest(client.label, span.label, span.from, span.to, shipped);
  const space = client.slug;
  const hash = genSlug(12);
  await env.BUCKET.put(payloadKey(space, hash, source), text, {
    httpMetadata: { contentType: contentTypeFor(source) },
  });
  const meta: Meta = {
    space, hash, uploader, createdAt: t,
    expiresAt: t + DEFAULT_ARTIFACT_DAYS * 86400,
    files: [{ path: source, size: new TextEncoder().encode(text).byteLength, type: contentTypeFor(source) }],
  };
  await writeMeta(env, meta);

  const empty = shipped.prs.length === 0 && shipped.releases.length === 0;
  // Nothing to compose: the digest says so, and no model call is spent on it.
  if (empty) return { ok: true, space, hash, path: source, source, empty };

  const name = FORMATS.find((f) => f.key === format)?.generation ?? 'agenda';
  const written = await writeGeneration({
    ai, env, space, hash, name, t,
    sources: [{ path: source, text }],
    instructions: await instructionsFor(env, client.slug, format),
  });
  if (!written) return fail(502, 'the model call failed; the digest is saved on the working page');
  return { ok: true, space, hash, path: written.path, source, empty };
}
