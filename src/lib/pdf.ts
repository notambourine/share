/**
 * Cloudflare Browser Rendering, driven to the free plan's limits.
 *
 * The scarce resource is 10 browser-minutes a day across the whole account,
 * not CPU and not the script cap. Everything here exists to spend fewer of
 * them: reuse a live session instead of launching, take both artifacts from
 * one page load, and give up rather than queue when the account is full.
 *
 * Every failure path returns null. A caller that cannot get a render serves
 * the live client-side shell instead. A missing PDF is a worse day than a
 * broken one.
 */

import puppeteer, { type Browser, type PDFOptions } from '@cloudflare/puppeteer';
import { numbersAt, numberAt, parseObject } from './json';

/**
 * Cloudflare allows one new browser every 20 seconds. A session that outlives
 * that window means the next request reuses rather than gets refused. Idle
 * keep-alive still bills against the 10 daily minutes, so it stops there.
 */
const KEEP_ALIVE_MS = 30_000;

/** A cold browser plus Marpit plus font loading. Past this, degrade. */
const RENDER_TIMEOUT_MS = 20_000;

/* A string, not a function: the Worker's tsconfig carries no DOM lib, and the
   browser's answer comes back through the JSON decoder like any boundary. The
   page is open anyway, so the fit question costs no browser budget. The +1
   forgives sub-pixel rounding, not real clipping. */
const MEASURE_SLIDES = `(() => {
  const sections = Array.from(document.querySelectorAll('svg[data-marpit-svg] foreignObject > section'));
  return JSON.stringify({
    slides: sections.length,
    overflow: sections.flatMap((s, i) => (s.scrollHeight > s.clientHeight + 1 ? [i + 1] : [])),
  });
})()`;

/** A slide box is fixed; content taller than it is silently clipped, and only
    a laid-out page knows. `overflow` holds the 1-indexed slides that clip. */
export type SlideCheck = {
  slides: number;
  overflow: number[];
};

/** The stored check.json crossing back in. */
export function decodeSlideCheck(text: string): SlideCheck | null {
  const record = parseObject(text);
  if (!record) return null;
  const slides = numberAt(record, 'slides');
  const overflow = numbersAt(record, 'overflow');
  return slides !== null && overflow !== null ? { slides, overflow } : null;
}

export interface Artifacts {
  pdf: Uint8Array;
  /** Slides renders only; null on doc renders or when the measure failed. */
  check: SlideCheck | null;
}

async function acquire(binding: Fetcher): Promise<Browser | null> {
  /* Reuse across invocations, not just across files in one upload: an upload
     arriving 10 seconds after another cannot open a browser of its own. */
  try {
    for (const session of await puppeteer.sessions(binding)) {
      if (session.connectionId) continue; // another worker is driving it
      try {
        return await puppeteer.connect(binding, session.sessionId);
      } catch { /* raced someone else to it; try the next */ }
    }
  } catch { /* session list is advisory; fall through to a launch */ }

  try {
    const limits = await puppeteer.limits(binding);
    if (limits.allowedBrowserAcquisitions < 1) {
      console.log(`pdf: budget spent, next browser in ${limits.timeUntilNextAllowedBrowserAcquisition}s`);
      return null;
    }
  } catch { /* let launch report the truth instead */ }

  try {
    return await puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MS });
  } catch (err) {
    console.log(`pdf: launch failed: ${err}`);
    return null;
  }
}

type BrowserPage = Awaited<ReturnType<Browser['newPage']>>;

async function withPage<T>(binding: Fetcher, work: (page: BrowserPage) => Promise<T>): Promise<T | null> {
  const browser = await acquire(binding);
  if (!browser) return null;

  let page: BrowserPage | null = null;
  try {
    page = await browser.newPage();
    return await work(page);
  } catch (err) {
    console.log(`pdf: render failed: ${err}`);
    return null;
  } finally {
    if (page) await page.close().catch(() => { /* the session outlives the page */ });
    /* disconnect, not close: the browser stays warm for the next request
       inside the 20-second new-instance window. */
    try {
      browser.disconnect();
    } catch { /* already gone */ }
  }
}

/**
 * One page load, one PDF, plus the fit question answered while the page is still
 * open - measuring it costs no browser budget, and only a laid-out page knows.
 */
export function render(
  binding: Fetcher, html: string, pdfOptions: PDFOptions, measureSlides = false,
): Promise<Artifacts | null> {
  return withPage(binding, async (page) => {
    await page.setContent(html);
    /* The print HTML flags itself once the faces have landed. A load event fires
       before a webfont swap, and typesetting against the fallback would reflow
       every line of the PDF. */
    await page.waitForSelector('html[data-ready="1"]', { timeout: RENDER_TIMEOUT_MS });
    let check: SlideCheck | null = null;
    if (measureSlides) {
      try {
        const raw: unknown = await page.evaluate(MEASURE_SLIDES);
        check = decodeSlideCheck(String(raw));
      } catch (err) {
        console.log(`pdf: overflow measure failed: ${err}`);
      }
    }
    const pdf = await page.pdf(pdfOptions);
    return { pdf: new Uint8Array(pdf), check };
  });
}

/** The browser shot's box; the full shot keeps the width at content height. */
const PAGE_VIEWPORT = { width: 1280, height: 720 };

export interface PageArtifacts {
  pdf: Uint8Array;
  browserPng: Uint8Array;
  fullPng: Uint8Array;
}

/**
 * Navigate-based render for an uploaded page: the browser loads the served
 * URL, so relative assets resolve and the source is never rebuilt. One load,
 * three artifacts. Uploaded HTML carries no ready flag, so networkidle0
 * stands in, plus a fonts.ready await for the late face swap idle can miss.
 */
export function renderPage(binding: Fetcher, url: string, pdfOptions: PDFOptions): Promise<PageArtifacts | null> {
  return withPage(binding, async (page) => {
    await page.setViewport(PAGE_VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });
    await page.evaluate('document.fonts.ready.then(() => 1)');
    const browserPng = new Uint8Array(await page.screenshot());
    const fullPng = new Uint8Array(await page.screenshot({ fullPage: true }));
    const pdf = new Uint8Array(await page.pdf(pdfOptions));
    return { pdf, browserPng, fullPng };
  });
}
