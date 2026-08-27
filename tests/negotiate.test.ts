import { describe, expect, it } from 'vitest';
import { acceptsHtml, isUnfurlBot, viewModeFor } from '../src/lib/negotiate';

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8';
const IMG_TAG = 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5';
const CURL = '*/*';
const SLACK = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const CURL_UA = 'curl/8.7.1';

const q = (s = '') => new URLSearchParams(s);

describe('acceptsHtml', () => {
  it('address bar yes, img tag and curl no', () => {
    expect(acceptsHtml(BROWSER)).toBe(true);
    expect(acceptsHtml(IMG_TAG)).toBe(false);
    expect(acceptsHtml(CURL)).toBe(false);
    expect(acceptsHtml(null)).toBe(false);
  });
});

describe('viewModeFor', () => {
  it('image: shell for browsers, raw for hotlinks', () => {
    expect(viewModeFor('shot.png', BROWSER, q())).toBe('shell-image');
    expect(viewModeFor('shot.png', IMG_TAG, q())).toBe('raw');
    expect(viewModeFor('shot.png', CURL, q())).toBe('raw');
  });

  it('?raw and ?view override Accept', () => {
    expect(viewModeFor('shot.png', BROWSER, q('raw'))).toBe('raw');
    expect(viewModeFor('shot.png', CURL, q('view'))).toBe('shell-image');
  });

  it('code highlights in browser, plain elsewhere', () => {
    expect(viewModeFor('main.ts', BROWSER, q())).toBe('shell-code');
    expect(viewModeFor('main.ts', CURL, q())).toBe('raw');
  });

  it('markdown renders in the shell whatever the query says; the content picks the mode', () => {
    expect(viewModeFor('deck.md', BROWSER, q())).toBe('shell-md');
    expect(viewModeFor('deck.md', BROWSER, q('slides'))).toBe('shell-md');
    expect(viewModeFor('deck.md', CURL, q())).toBe('raw');
  });

  it('html is the page itself everywhere; ?view=source highlights', () => {
    expect(viewModeFor('index.html', BROWSER, q())).toBe('page');
    expect(viewModeFor('index.html', CURL, q())).toBe('page');
    expect(viewModeFor('index.html', BROWSER, q('view=source'))).toBe('shell-code');
  });

  it('svg never serves inline: shell in browser, attachment raw', () => {
    expect(viewModeFor('logo.svg', BROWSER, q())).toBe('shell-svg');
    expect(viewModeFor('logo.svg', CURL, q())).toBe('attachment');
    expect(viewModeFor('logo.svg', BROWSER, q('raw'))).toBe('attachment');
  });

  it('unknown types get a download card or an attachment', () => {
    expect(viewModeFor('report.pdf', BROWSER, q())).toBe('shell-download');
    expect(viewModeFor('report.pdf', CURL, q())).toBe('attachment');
  });

  it('video: shell in browser, raw bytes for players', () => {
    expect(viewModeFor('demo.mp4', BROWSER, q())).toBe('shell-video');
    expect(viewModeFor('demo.mp4', 'video/*', q())).toBe('raw');
  });
});

describe('isUnfurlBot', () => {
  it('knows the crawlers and leaves curl alone', () => {
    expect(isUnfurlBot(SLACK)).toBe(true);
    expect(isUnfurlBot('Twitterbot/1.0')).toBe(true);
    expect(isUnfurlBot('facebookexternalhit/1.1')).toBe(true);
    expect(isUnfurlBot(CURL_UA)).toBe(false);
    expect(isUnfurlBot(null)).toBe(false);
  });
});

describe('viewModeFor, unfurl crawlers', () => {
  /* The bug this exists for: Slack asks exactly like curl, so before the
     User-Agent rule it got 8 MB of video and no tag to read, and drew nothing. */
  it('a crawler gets the shell where curl gets bytes', () => {
    expect(viewModeFor('demo.mp4', CURL, q(), CURL_UA)).toBe('raw');
    expect(viewModeFor('demo.mp4', CURL, q(), SLACK)).toBe('shell-video');
    expect(viewModeFor('report.pdf', CURL, q(), SLACK)).toBe('shell-download');
    expect(viewModeFor('main.ts', CURL, q(), SLACK)).toBe('shell-code');
  });

  it('an image still answers in bytes: Slack renders those itself', () => {
    expect(viewModeFor('shot.png', CURL, q(), SLACK)).toBe('raw');
  });

  it('uploaded html serves as itself, crawler or not', () => {
    expect(viewModeFor('index.html', CURL, q(), SLACK)).toBe('page');
  });

  /* og:image points at ?raw, and the crawler fetches it with the same UA. Lose
     this and the poster answers with a second HTML page instead of a picture. */
  it('?raw beats the crawler rule, so og:image resolves to bytes', () => {
    expect(viewModeFor('demo.mp4.poster.jpg', CURL, q('raw'), SLACK)).toBe('raw');
    expect(viewModeFor('demo.mp4', CURL, q('raw'), SLACK)).toBe('raw');
  });
});
