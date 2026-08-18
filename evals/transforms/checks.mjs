/* Deterministic graders for a transform's output. Structure says "came out as
   the format", retention says "kept the facts", fabrication says "added none".
   Tone and judgment stay human: read out/ after any prompt edit. */

const DECKS = new Set(['deck', 'presentation']);

/* Trailing punctuation belongs to the sentence, not the URL, on either side. */
const urlsOf = (text) =>
  new Set((text.match(/https?:\/\/[^\s)>"'\]]+/g) ?? []).map((u) => u.replace(/[.,]+$/, '')));

const moneyOf = (text) => new Set(text.match(/\$\d[\d,.]*/g) ?? []);

function common(output, input) {
  const first = output.split('\n', 1)[0].trim();
  const checks = [
    { name: 'no-preamble', pass: /^(#|---$|<!--)/.test(first), detail: first.slice(0, 60) },
    { name: 'no-fence-wrap', pass: !output.startsWith('```') },
    { name: 'no-think-block', pass: !output.includes('<think>') },
  ];
  // Verbatim-fact gates: a URL or dollar amount the input never carried is fabrication.
  const inputUrls = urlsOf(input);
  for (const url of urlsOf(output)) {
    checks.push({ name: 'url-from-input', pass: inputUrls.has(url), detail: url });
  }
  const inputMoney = moneyOf(input);
  for (const amount of moneyOf(output)) {
    checks.push({ name: 'amount-from-input', pass: inputMoney.has(amount), detail: amount });
  }
  return checks;
}

function deckChecks(output) {
  const parts = output.split(/\n---\n/);
  const slides = parts.slice(1); // parts[0] is the front matter block
  const checks = [
    {
      name: 'marp-front-matter',
      pass: output.startsWith('---\n') && parts[0].includes('marp: true'),
    },
    { name: 'three-plus-slides', pass: slides.length >= 3, detail: `${slides.length} slides` },
  ];
  slides.forEach((slide, i) => {
    // The prompt says 12; grading at 16 leaves room without letting a wall through.
    const lines = slide.split('\n').filter((l) => l.trim() !== '').length;
    if (lines > 16) {
      checks.push({ name: 'slide-fits', pass: false, detail: `slide ${i + 1}: ${lines} lines` });
    }
  });
  return checks;
}

function docChecks(output) {
  return [
    { name: 'has-title', pass: /^# /m.test(output) },
    {
      name: 'has-sections',
      pass: (output.match(/^## /gm) ?? []).length >= 2,
      detail: 'wants two or more ## sections',
    },
    { name: 'not-a-deck', pass: !output.includes('marp: true') },
  ];
}

/** Every check for one (transform, fixture) run. `facts` is the fixture's
    must-keep.json entry: keep = survives any faithful reformat, drop = the
    injected instruction stays inert. */
export function checksFor(transform, output, input, facts) {
  const low = output.toLowerCase();
  return [
    ...common(output, input),
    ...(DECKS.has(transform) ? deckChecks(output) : docChecks(output)),
    ...facts.keep.map((s) => ({ name: 'kept', pass: low.includes(s.toLowerCase()), detail: s })),
    ...facts.drop.map((s) => ({ name: 'dropped', pass: !low.includes(s.toLowerCase()), detail: s })),
  ];
}
