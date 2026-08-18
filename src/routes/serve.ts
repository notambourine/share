import type { Deferrals, Env } from '../lib/types';
import { DEFAULT_LINK_DAYS } from '../lib/types';
import { readMetaTagged, writeMeta, isExpired } from '../lib/r2';
import { mintToken, parseSigningKeys, verifyToken } from '../lib/sign';
import { verifyAdminToken } from '../lib/admin';
import { viewModeFor } from '../lib/negotiate';
import { explicitMode, isLiveHtml, resolveExport, sniffDeck } from '../lib/exportPath';
import { exportArtifact } from './export';
import { rawBytes } from '../lib/bytes';
import { fileShell, dirShell, errorShell, adminShell, type ShellOpts } from '../render/shell';
import { renderCode, renderDeck, renderMarkdown } from '../render/markdown';
import { DECK_THEME } from '../brand';
import { htmlResponse, now } from '../lib/http';

const DAY = 86400;

/** Past this a shell would carry more bytes than a download costs, and
    highlighting them would spend real CPU on a file nobody reads in a browser.
    `?raw` still hands over every byte. */
const MAX_INLINE_BYTES = 1024 * 1024;

function sourceText(env: Env, space: string, hash: string, path: string): Promise<string | null> {
  return env.BUCKET.get(`${space}/${hash}/f/${path}`).then((o) => (o ? o.text() : null));
}

/**
 * A markdown source, rendered here rather than in the reader's browser. `mode`
 * null means the content decides, which is the bare `.md` URL; the `.html`
 * spellings pass the mode they pin.
 */
async function markdownView(
  env: Env, space: string, hash: string, mode: 'slides' | 'doc' | null, opts: ShellOpts,
): Promise<Response> {
  const text = await sourceText(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  if ((mode ?? (sniffDeck(text) ? 'slides' : 'doc')) === 'doc') {
    return htmlResponse(fileShell('md', { ...opts, content: renderMarkdown(text) }));
  }
  const { html, css } = renderDeck(text, DECK_THEME);
  return htmlResponse(fileShell('slides', { ...opts, content: html, deckCss: css }));
}

async function codeView(
  env: Env, space: string, hash: string, opts: ShellOpts,
): Promise<Response> {
  const text = await sourceText(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  return htmlResponse(fileShell('code', { ...opts, content: renderCode(text, opts.path) }));
}

export async function serve(
  request: Request,
  env: Env,
  ctx: Deferrals,
  space: string,
  hash: string,
  token: string | null,
  rest: string,
): Promise<Response> {
  const tagged = await readMetaTagged(env, space, hash);
  const t = now();
  if (!tagged || isExpired(tagged.meta, t)) return htmlResponse(errorShell(404), 404);
  const { meta, etag } = tagged;

  const url = new URL(request.url);

  /* A live `?c=` wins the artifact root, checked ahead of the signed-tier 401:
     admin implies view. Invalid, absent, or expired falls through to today's
     view, never a 401 of its own. Root only - a file path ignores c=. */
  if (rest === '') {
    const c = url.searchParams.get('c');
    const keys = c && parseSigningKeys(env);
    if (c && keys && (await verifyAdminToken(keys, space, hash, c, t)).ok) {
      /* The page's links must travel, so on the signed tier they ride a fresh
         view token at the /sign default life - the admin holder is the
         uploader, and handing out links is the page's job. */
      const kSeg = meta.tier === 'signed'
        ? `k/${await mintToken(keys, `${space}/${hash}`, t + DEFAULT_LINK_DAYS * 86400)}/`
        : '';
      return htmlResponse(adminShell({ meta, origin: url.origin, kSeg, now: t }));
    }
  }

  if (meta.tier === 'signed') {
    if (!token) return htmlResponse(errorShell(401), 401);
    const keys = parseSigningKeys(env);
    if (!keys) return htmlResponse(errorShell(401), 401);
    const v = await verifyToken(keys, `${space}/${hash}`, token, t);
    if (!v.ok) return htmlResponse(errorShell(401), 401);
  }

  // Idle-TTL uploads pay the bookkeeping: at most one meta rewrite per day.
  // Conditional on the etag read above, so it can never clobber an admin TTL
  // edit that landed in between; losing a day's touch to that race is nothing.
  if (meta.idleTtl !== null && t - meta.lastAccess > DAY) {
    ctx.waitUntil(writeMeta(env, { ...meta, lastAccess: t }, etag));
  }

  let filePath = rest;
  if (filePath === '') {
    if (meta.files.some((f) => f.path === 'index.html')) {
      filePath = 'index.html';
    } else {
      return htmlResponse(dirShell(hash, meta.files));
    }
  }

  const file = meta.files.find((f) => f.path === filePath);
  if (!file) {
    /* A poster is not a row of its own, so it resolves off the parent that
       owns it - and always as bytes, because og:image is what asks. */
    if (meta.files.some((f) => f.poster === filePath)) {
      return rawBytes(request, env, `${space}/${hash}/f/${filePath}`, filePath, false);
    }
    /* Exact match first, then the format suffixes, so a file uploaded as
       `notes.pdf` serves its own bytes instead of re-rendering `notes`. */
    const wanted = resolveExport(meta.files.map((f) => f.path), filePath);
    if (!wanted) return htmlResponse(errorShell(404), 404);
    const src = meta.files.find((f) => f.path === wanted.source);
    if (!src) return htmlResponse(errorShell(404), 404);
    /* An `.html` spelling is a mode override, not an artifact: it renders here
       and stores nothing, so only `.pdf`, `.png`, and `.txt` reach the export. */
    if (isLiveHtml(wanted.source, wanted.format)) {
      const dir = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
      return markdownView(env, space, hash, explicitMode(wanted.format), {
        path: wanted.source,
        rawHref: `${url.origin}${dir}${encodeURI(wanted.source)}?raw`,
        size: src.size,
        pageHref: `${url.origin}${url.pathname}`,
      });
    }
    return exportArtifact(request, env, {
      space, hash, url, source: wanted.source, format: wanted.format, size: src.size,
    });
  }

  const mode = viewModeFor(
    filePath, request.headers.get('accept'), url.searchParams, request.headers.get('user-agent'),
  );
  const rawHref = `${url.origin}${url.pathname}${url.pathname.endsWith('/') ? 'index.html' : ''}?raw`;
  /* Built from the segments rather than sliced off the pathname: the poster is
     a sibling of the file, not of the URL, and a request under a subdirectory
     would otherwise hang it off the wrong base. */
  const root = `${url.origin}/${space}/${hash}/${token ? `k/${token}/` : ''}`;
  const opts = {
    path: filePath,
    rawHref,
    size: file.size,
    pageHref: `${url.origin}${url.pathname}`,
    ...(file.poster && { posterHref: `${root}${encodeURI(file.poster)}?raw` }),
  };

  switch (mode) {
    case 'shell-image': return htmlResponse(fileShell('image', opts));
    case 'shell-video': return htmlResponse(fileShell('video', opts));
    case 'shell-svg': return htmlResponse(fileShell('svg', opts));
    /* Both read their bytes to render them, so both fall back to the download
       card rather than inline a file too big to read in a browser anyway. */
    case 'shell-code':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell('download', opts))
        : codeView(env, space, hash, opts);
    case 'shell-md':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell('download', opts))
        : markdownView(env, space, hash, null, opts);
    case 'shell-download': return htmlResponse(fileShell('download', opts));
    default:
      return rawBytes(request, env, `${space}/${hash}/f/${filePath}`, filePath, mode === 'attachment');
  }
}
