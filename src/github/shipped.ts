/**
 * What shipped: merged PRs and published releases across a client's repos in a
 * window, flattened to one markdown digest the model composes from.
 */

import type { JsonObject } from '../lib/json';
import { isJsonObject, numberAt, parseObject, parseJson, recordsAt, textAt } from '../lib/json';
import { github } from './app';

export interface ShippedPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  mergedAt: string;
  labels: string[];
  body: string;
}

export interface ShippedRelease {
  repo: string;
  name: string;
  tag: string;
  url: string;
  publishedAt: string;
  body: string;
}

export interface Shipped {
  prs: ShippedPr[];
  releases: ShippedRelease[];
}

/** A PR body carries the why; past this it is template boilerplate and logs. */
const BODY_CHARS = 600;

const SEARCH = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url mergedAt bodyText
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
      }
    }
  }
}`;

function at(record: JsonObject | null, ...path: string[]): JsonObject | null {
  let cur = record;
  for (const key of path) {
    const next = cur?.[key];
    cur = next !== undefined && next !== null && isJsonObject(next) ? next : null;
  }
  return cur;
}

function decodePr(node: JsonObject): ShippedPr | null {
  const number = numberAt(node, 'number');
  const title = textAt(node, 'title');
  const url = textAt(node, 'url');
  const mergedAt = textAt(node, 'mergedAt');
  const repo = textAt(at(node, 'repository') ?? {}, 'nameWithOwner');
  if (number === null || !title || !url || !mergedAt || !repo) return null;
  return {
    repo, number, title, url, mergedAt,
    author: textAt(at(node, 'author') ?? {}, 'login'),
    labels: (recordsAt(at(node, 'labels') ?? {}, 'nodes') ?? []).map((l) => textAt(l, 'name')).filter((n): n is string => n !== null),
    body: (textAt(node, 'bodyText') ?? '').slice(0, BODY_CHARS),
  };
}

const day = (iso: string): string => iso.slice(0, 10);

/** GitHub search takes whole-second UTC instants on `merged:`. */
const stamp = (t: number): string => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Every merged PR in `repos` (one owner, one token) inside [from, to). */
export async function mergedPrs(token: string, repos: string[], from: number, to: number): Promise<ShippedPr[]> {
  const q = `is:pr is:merged merged:${stamp(from)}..${stamp(to - 1)} ${repos.map((r) => `repo:${r}`).join(' ')}`;
  const out: ShippedPr[] = [];
  let after: string | null = null;
  do {
    const res = await github('/graphql', token, {
      method: 'POST',
      body: JSON.stringify({ query: SEARCH, variables: { q, after } }),
    });
    if (!res.ok) throw new Error(`GitHub search ${res.status}`);
    const search = at(parseObject(await res.text()), 'data', 'search');
    if (!search) throw new Error('GitHub search answered no data');
    for (const node of recordsAt(search, 'nodes') ?? []) {
      const pr = decodePr(node);
      if (pr) out.push(pr);
    }
    const page = at(search, 'pageInfo');
    after = page && page['hasNextPage'] === true ? textAt(page, 'endCursor') : null;
  } while (after);
  return out;
}

/** Releases published inside [from, to), newest first per repo. */
export async function releases(token: string, repo: string, from: number, to: number): Promise<ShippedRelease[]> {
  const res = await github(`/repos/${repo}/releases?per_page=30`, token);
  if (!res.ok) return [];
  const list = parseJson(await res.text());
  if (!Array.isArray(list)) return [];
  const out: ShippedRelease[] = [];
  for (const item of list) {
    if (!isJsonObject(item) || item['draft'] === true) continue;
    const publishedAt = textAt(item, 'published_at');
    const url = textAt(item, 'html_url');
    const tag = textAt(item, 'tag_name');
    if (!publishedAt || !url || !tag) continue;
    const t = Date.parse(publishedAt) / 1000;
    if (t < from || t >= to) continue;
    out.push({
      repo, tag, url, publishedAt,
      name: textAt(item, 'name') || tag,
      body: (textAt(item, 'body') ?? '').slice(0, BODY_CHARS),
    });
  }
  return out;
}

/**
 * The digest a generation reads, grouped by repo, oldest merge first so the
 * story reads forward. Plain facts only: the prompt owns the voice.
 */
export function digest(label: string, windowLabel: string, from: number, to: number, shipped: Shipped): string {
  const repos = [...new Set([...shipped.prs.map((p) => p.repo), ...shipped.releases.map((r) => r.repo)])].sort();
  const lines = [
    `# What shipped: ${label}`,
    '',
    `Window: ${windowLabel} (${day(stamp(from))} to ${day(stamp(to - 1))}, UTC).`,
    `${shipped.prs.length} merged pull requests, ${shipped.releases.length} releases.`,
  ];
  for (const repo of repos) {
    lines.push('', `## ${repo}`);
    for (const r of shipped.releases.filter((x) => x.repo === repo)) {
      lines.push('', `- Release ${r.name} (${r.tag}), ${day(r.publishedAt)}: ${r.url}`);
      if (r.body.trim()) lines.push(`  ${r.body.trim().replace(/\s+/g, ' ')}`);
    }
    const prs = shipped.prs.filter((p) => p.repo === repo).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
    for (const p of prs) {
      const tags = p.labels.length ? ` [${p.labels.join(', ')}]` : '';
      const by = p.author ? ` by ${p.author}` : '';
      lines.push('', `- #${p.number} ${p.title}${tags}, merged ${day(p.mergedAt)}${by}: ${p.url}`);
      if (p.body.trim()) lines.push(`  ${p.body.trim().replace(/\s+/g, ' ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
