import { kindOf, type Kind } from './keys';

export type ViewMode =
  | 'raw'          // the bytes, correct content type
  | 'attachment'   // the bytes, Content-Disposition: attachment
  | 'page'         // uploaded HTML served as itself
  | 'shell-image' | 'shell-video' | 'shell-svg'
  | 'shell-code' | 'shell-md' | 'shell-slides'
  | 'shell-download';

/**
 * One rule: Accept decides, query string overrides (R7, R8).
 * A browser address bar sends text/html -> branded shell.
 * <img src>, Slack unfurls, curl -> raw bytes. Responses carry Vary: Accept.
 */
export function acceptsHtml(accept: string | null): boolean {
  if (!accept) return false;
  return accept.split(',').some((part) => {
    const mime = part.split(';')[0].trim().toLowerCase();
    return mime === 'text/html' || mime === 'application/xhtml+xml';
  });
}

export function viewModeFor(
  path: string, accept: string | null, params: URLSearchParams,
): ViewMode {
  const kind: Kind = kindOf(path);

  if (params.has('raw')) {
    // ?raw always means bytes; svg and unknown types still download, never render inline.
    if (kind === 'svg' || kind === 'other') return 'attachment';
    if (kind === 'html') return 'page';
    return 'raw';
  }

  const wantsView = params.has('view') || params.has('slides');
  const browser = wantsView || acceptsHtml(accept);

  if (!browser) {
    if (kind === 'svg' || kind === 'other') return 'attachment';
    if (kind === 'html') return 'page';
    return 'raw';
  }

  switch (kind) {
    case 'image': return 'shell-image';
    case 'video': return 'shell-video';
    case 'svg': return 'shell-svg';
    case 'md': return params.has('slides') ? 'shell-slides' : 'shell-md';
    case 'code': return 'shell-code';
    case 'html': return params.get('view') === 'source' ? 'shell-code' : 'page';
    default: return 'shell-download';
  }
}
