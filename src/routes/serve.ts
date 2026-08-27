import type { Env } from '../lib/types';
import type { ParsedRoute } from '../lib/route';
import { payloadKey, readPayload, readMeta, isExpired } from '../lib/r2';
import { parseSigningKeys } from '../lib/sign';
import { verifyAdminToken } from '../lib/admin';
import { viewModeFor } from '../lib/negotiate';
import { latestStamped, resolveExport, stemOf } from '../lib/exportPath';
import { buildIndex } from '../lib/artifact';
import { exportArtifact } from './export';
import { rawBytes } from '../lib/bytes';
import { fileShell, indexShell, errorShell, adminShell, type ShellCommon } from '../render/shell';
import { renderCode, renderSource } from '../render/markdown';
import { htmlResponse, jsonResponse, wantsJson } from '../lib/http';
import { now } from '../lib/clock';

/** Past this a shell would carry more bytes than a download costs, and
    highlighting them would spend real CPU on a file nobody reads in a browser.
    `?raw` still hands over every byte. */
const MAX_INLINE_BYTES = 1024 * 1024;

/**
 * A markdown source, rendered here rather than in the reader's browser. Deck or
 * document comes from the content, always: nothing pins a mode any more, and
 * which shell it lands in follows what the render resolved.
 */
async function markdownView(
  env: Env, space: string, hash: string, opts: ShellCommon,
): Promise<Response> {
  const text = await readPayload(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  const out = renderSource(text, null);
  return htmlResponse(out.mode === 'slides'
    ? fileShell(opts, { kind: 'slides', html: out.html, css: out.css })
    : fileShell(opts, { kind: 'md', html: out.html }));
}

async function codeView(
  env: Env, space: string, hash: string, opts: ShellCommon,
): Promise<Response> {
  const text = await readPayload(env, space, hash, opts.path);
  if (text === null) return htmlResponse(errorShell(404), 404);
  return htmlResponse(fileShell(opts, { kind: 'code', html: renderCode(text, opts.path) }));
}

export async function serve(
  request: Request,
  env: Env,
  route: ParsedRoute,
): Promise<Response> {
  const { space, hash, rest } = route;
  const meta = await readMeta(env, space, hash);
  const t = now();
  if (!meta || isExpired(meta, t)) return htmlResponse(errorShell(404), 404);

  const url = new URL(request.url);

  /* A live `?c=` wins the artifact root: it is the working page, and admin
     implies view. Invalid, absent, or expired falls through to the public index,
     never a 401 of its own. Root only - a file path ignores c=. */
  if (rest === '') {
    const c = url.searchParams.get('c');
    const keys = c ? parseSigningKeys(env) : null;
    const v = c && keys ? await verifyAdminToken(keys, space, hash, c, t) : null;
    if (v?.ok) {
      return htmlResponse(adminShell({ meta, origin: route.origin, now: t, adminExp: v.exp }));
    }
  }

  let filePath = rest;
  if (filePath === '') {
    if (meta.files.some((f) => f.path === 'index.html')) {
      filePath = 'index.html';
    } else {
      /* The public index: one URL, two representations. The JSON is what an
         external agent reads, which is why no route answers status any more. */
      const index = await buildIndex(env, meta);
      return wantsJson(request)
        ? jsonResponse({ ...index })
        : htmlResponse(indexShell(index, meta));
    }
  }

  const paths = meta.files.map((f) => f.path);
  /* A bare source name follows the newest generation: `deck.md` resolves to the
     highest `deck.<epoch>.md` this share holds. An uploaded file that owns the
     name is found by the exact lookup above it and never reaches here. */
  if (!paths.includes(filePath) && stemOf(filePath) !== filePath) {
    const current = latestStamped(paths, stemOf(filePath));
    if (current) filePath = current;
  }

  const file = meta.files.find((f) => f.path === filePath);
  if (!file) {
    /* A poster is not a row of its own, so it resolves off the parent that
       owns it - and always as bytes, because og:image is what asks. */
    if (meta.files.some((f) => f.poster === filePath)) {
      return rawBytes(request, env, payloadKey(space, hash, filePath), filePath, false);
    }
    /* Exact match first, then the two format suffixes, so a file uploaded as
       `notes.pdf` serves its own bytes instead of re-rendering `notes`. */
    const wanted = resolveExport(paths, filePath);
    if (!wanted) return htmlResponse(errorShell(404), 404);
    const src = meta.files.find((f) => f.path === wanted.source);
    if (!src) return htmlResponse(errorShell(404), 404);
    return exportArtifact(request, env, {
      space, hash, url, source: wanted.source, format: wanted.format, size: src.size,
    });
  }

  const mode = viewModeFor(
    filePath, request.headers.get('accept'), url.searchParams, request.headers.get('user-agent'),
  );
  /* Hung off the artifact root, not the request path: the poster is a sibling
     of the file, so a request under a subdirectory would otherwise base it
     wrong. Only the video and svg shells read it. */
  const poster = file.poster ? { posterHref: `${route.root}${encodeURI(file.poster)}?raw` } : {};
  const opts = {
    path: filePath,
    rawHref: `${route.page}${route.page.endsWith('/') ? 'index.html' : ''}?raw`,
    size: file.size,
    pageHref: route.page,
  };

  switch (mode) {
    case 'shell-image': return htmlResponse(fileShell(opts, { kind: 'image' }));
    case 'shell-video': return htmlResponse(fileShell(opts, { kind: 'video', ...poster }));
    case 'shell-svg': return htmlResponse(fileShell(opts, { kind: 'svg', ...poster }));
    /* Both read their bytes to render them, so both fall back to the download
       card rather than inline a file too big to read in a browser anyway. */
    case 'shell-code':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell(opts, { kind: 'download' }))
        : codeView(env, space, hash, opts);
    case 'shell-md':
      return file.size > MAX_INLINE_BYTES
        ? htmlResponse(fileShell(opts, { kind: 'download' }))
        : markdownView(env, space, hash, opts);
    case 'shell-download': return htmlResponse(fileShell(opts, { kind: 'download' }));
    default:
      return rawBytes(request, env, payloadKey(space, hash, filePath), filePath, mode === 'attachment');
  }
}
