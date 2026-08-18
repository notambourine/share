import { kindOf, type Kind } from './keys';

export type ViewMode =
  | 'raw'          // the bytes, correct content type
  | 'attachment'   // the bytes, Content-Disposition: attachment
  | 'page'         // uploaded HTML served as itself
  | 'shell-image' | 'shell-video' | 'shell-svg'
  | 'shell-code' | 'shell-md'
  | 'shell-download';

/**
 * One rule: Accept decides, query string overrides, and an unfurl crawler is
 * the exception Accept cannot see.
 * A browser address bar sends text/html -> branded shell.
 * <img src>, curl -> raw bytes. Responses carry Vary: Accept, User-Agent.
 */
export function acceptsHtml(accept: string | null): boolean {
  if (!accept) return false;
  return accept.split(',').some((part) => {
    const mime = part.split(';')[0].trim().toLowerCase();
    return mime === 'text/html' || mime === 'application/xhtml+xml';
  });
}

/* Matched on User-Agent because these ask exactly like curl: Slack sends no
   text/html in Accept, so the Accept rule alone hands it 8 MB of video with no
   tag to read, and it draws nothing. Slack documents that it ignores
   robots.txt, so the noindex header is not what has to change. */
const UNFURL_BOTS = /slackbot-linkexpanding|twitterbot|facebookexternalhit|discordbot|linkedinbot|telegrambot|whatsapp|skypeuripreview|redditbot|embedly|iframely|pinterest/i;

export function isUnfurlBot(ua: string | null): boolean {
  return ua !== null && UNFURL_BOTS.test(ua);
}

export function viewModeFor(
  path: string, accept: string | null, params: URLSearchParams, ua: string | null = null,
): ViewMode {
  const kind: Kind = kindOf(path);

  if (params.has('raw')) {
    // ?raw always means bytes. SVG executes on a navigation, so it downloads
    // instead; the shell renders it inside an <img>. Unknown types download too.
    if (kind === 'svg' || kind === 'other') return 'attachment';
    if (kind === 'html') return 'page';
    return 'raw';
  }

  const wantsView = params.has('view');
  /* A crawler counts as a browser so it gets the shell and its tags. Never for
     an image: Slack renders image bytes into the message on its own, and a card
     linking the same picture would be a downgrade. `html` is exempt because it
     serves as itself either way and may carry tags of its own. */
  const bot = isUnfurlBot(ua) && kind !== 'image' && kind !== 'html';
  const browser = wantsView || acceptsHtml(accept) || bot;

  if (!browser) {
    if (kind === 'svg' || kind === 'other') return 'attachment';
    if (kind === 'html') return 'page';
    return 'raw';
  }

  switch (kind) {
    case 'image': return 'shell-image';
    case 'video': return 'shell-video';
    case 'svg': return 'shell-svg';
    case 'md': return 'shell-md';
    case 'code': return 'shell-code';
    case 'html': return params.get('view') === 'source' ? 'shell-code' : 'page';
    default: return 'shell-download';
  }
}
