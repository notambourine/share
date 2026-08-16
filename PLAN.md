# notambourine/share - plan

Pre-implementation plan and decision record. Written before any code exists. Once
the repo is built, the code is the source of truth for layout and config; what
stays useful here is the goal, the requirements, and the decisions with their
reasons.

## Goal

A place to put one-off generated artifacts and hand a link to one person.

Claude Code writes a report, a code sample, a deck, a screenshot. Today that file
has nowhere to live that is both quick and presentable. Email attachments are
clumsy, Drive links demand an account, and a public bucket URL looks like nothing.
The target is a single command that returns a URL, where the URL is branded enough
to send to a PE operating partner, unguessable enough to hold a client's material,
and revocable when the engagement ends.

The link is the product. Everything else serves it.

## Requirements

**Access**

- R1. A share URL must not be guessable from another share URL. Enumeration by
  walking a counter or a clock is out.
- R2. Search engines must never index a share URL, including images and other raw
  bytes, where a meta tag cannot reach.
- R3. A share must be revocable. Revoking must take effect within minutes, which
  constrains cache lifetime.
- R4. A share must be able to expire on a schedule, tunable per upload rather than
  fixed for the whole system.
- R5. Some artifacts must be lockable beyond an unguessable URL, without making the
  recipient create an account or complete an email round trip.
- R6. Artifacts are grouped by client or employee, and the group must be legible in
  the URL. Listing a group must not be possible without a credential.

**Content**

- R7. Images must stay hotlinkable. An `<img src>` and a Slack unfurl get bytes.
- R8. The same URL opened in a browser renders on brand: image centered, code
  syntax highlighted, markdown as a document.
- R9. Markdown must be able to render as slides.
- R10. Uploaded HTML must serve as a real page, rawgit style, with its own relative
  CSS, JS, and images resolving.
- R11. A multi-file upload keeps its internal structure. That is what R10 needs.

**Clients**

- R12. Uploading is one curl line an agent can copy without reading a manual.
- R13. An agent can discover the API without a human pasting docs, and can be
  handed the capability as a Claude skill.
- R14. The upload credential resolves from 1Password by `op://` reference and never
  lands in a transcript.
- R15. A CLI covers directory uploads, minting links, and revoking.

**Operations**

- R16. Runs on the Cloudflare free tier at expected volume.
- R17. Brand tokens do not drift from `notambourine/site` `src/styles/theme.css`.

## URL grammar

```
share.notambourine.com/<space>/<hash>/<path...>              open tier
share.notambourine.com/<space>/<hash>/k/<token>/<path...>    signed tier
                           |      |       `- report.png, main.ts, deck.md, index.html
                           |      `- 12 char base62, ~71 bits. This is the secret.
                           `- acme, sara, shots. Human readable, guessable on purpose.
```

- `/<space>/<hash>/` serves the upload's own `index.html` when it has one, else a
  branded listing of the files.
- `/<space>/` returns 404 to anonymous requests (R6). The hash is the credential,
  so a space must never enumerate. With Bearer auth it lists the space (R15).
- One hash holds a whole folder, so relative `./style.css` and `./app.js` resolve
  inside the prefix (R10, R11).
- The signed-tier token lives in the path, not the query string, because relative
  URLs drop a query string. A `?k=` on `index.html` would 401 every `./style.css`
  the page loads. A path segment above the filename rides along on every relative
  fetch, so signed folders work (R5 + R10 together).

## Raw vs rendered

One rule: `Accept` decides, query string overrides. A browser address bar sends
`text/html` and gets the branded view (R8). An `<img src>` sends `image/*` with no
`text/html` and gets raw bytes, so hotlinking and Slack unfurls work untouched
(R7). `curl` gets raw. `?raw` and `?view` force either. Responses carry
`Vary: Accept`.

| Uploaded | Browser | Everything else |
| --- | --- | --- |
| png, jpg, webp, gif, mp4 | centered on brand background, filename, copy-URL, og:image | raw bytes |
| ts, js, css, json, py, sh | syntax highlighted, line anchors | raw, correct content type |
| md | rendered doc; `?slides` runs Marpit | raw text |
| html | the page itself; `?view=source` highlights it | the page itself |
| svg | rendered inside an `<img>` in the shell | attachment, never inline |
| other | download card | attachment |

**Rendering happens in the browser.** The Worker emits a 3 kB branded shell that
fetches `?raw` and highlights or renders it client side. This stays inside the
10 ms free-plan CPU limit and the 3 MB script cap (R16), and a brand change ships
to every artifact ever uploaded without re-rendering anything. The cost is no-JS
support and weaker link previews on code pages, accepted.

The renderer libraries (highlight.js, marked, Marpit) are vendored into
`public/vendor/` at pinned versions, never loaded from a CDN. Third-party runtime
script has no place on a host serving client material, and vendoring lets shell
pages carry a self-only CSP.

**The brand faces are vendored for the same reason.** A Google Fonts `@import`
sent every artifact URL to Google as a `Referer`, on the exact pages serving
client material, and it forced an off-origin allowance into `SHELL_CSP`. Nunito,
Hanken Grotesk, and JetBrains Mono are self-hosted from `public/fonts` as latin
subset variable woff2, so `font-src` is `'self'` and no directive names an
external origin. `share.notambourine.com` is its own origin, so these are its own
copies rather than a path on the marketing site.

**Slides render through Marpit, not reveal.js.** Reveal split markdown on `---`
and nothing else, so every deck came out with the same layout. Marpit reads the
markdown-native directives (`_class`, `backgroundImage`, `paginate`) that let one
deck differ from another, and it is the engine under the `marp` CLI the team
already writes `.marp.md` against. Two costs, both accepted: Marpit ships CommonJS
for Node only, so `scripts/vendor.mjs` bundles it with esbuild instead of copying
a file, and the slides shell grew from 41 KB gzipped to 124 KB. Marpit renders to
static HTML with no navigation, so `public/render.js` owns the one-slide-at-a-time
view, the arrow keys, and the `#n` hash. The branded theme is
`public/vendor/marp/nt-marp.css`, written against the `tokens.css` custom
properties rather than mirrored, so a brand change reaches a deck with no second
edit. That theme has since moved upstream into the nt-brand golden set, and this
repo vendors it back; see "Brand coupling" below.

## Export formats

A markdown path takes a format suffix, resolved only after an exact filename
lookup misses, so a real uploaded file always wins its own name. `?slides` keeps
its name as a documented alias for `.slides.html`.

| URL | Output | Cached |
| --- | --- | --- |
| `deck.md` | branded shell, client-side | no |
| `deck.md.slides.html`, `?slides` | branded deck, client-side | no |
| `deck.md.html` | self-contained snapshot | yes |
| `deck.md.pdf` | deck or document, decided from the content | yes |
| `deck.md.slides.pdf` | deck PDF | yes |
| `deck.md.doc.pdf` | document PDF | yes |

Bare `.pdf` and `.html` sniff the content: `marp: true` front matter or `---`
slide separators mean deck. The explicit spellings beat the sniff, and both
`llms.txt` and `SKILL.md` name them, because an agent cannot guess a sniff.

**Cloudflare Browser Rendering, not WASM and not a CLI.** A PDF needs HTML and
CSS, which rules out pdf-lib. Typst as WASM is 3 MB against the script cap, and
it would be a second layout engine to keep on brand. A CLI is something every
person on the team has to install, and nothing that has to run on a laptop can
serve a URL. The Worker builds an HTML string with the markdown inlined and the
vendor URLs absolute, then calls `page.setContent()`. The headless browser runs
the same Marpit, marked, and highlight.js a viewer runs, so there is one render
path and the Worker still spends no CPU on markdown.

**Browser minutes are the binding constraint**, not CPU and not the script cap.
The free plan gives 10 browser-minutes per day account-wide, 3 concurrent
browsers, and one new browser every 20 seconds. At a few seconds per render that
is on the order of a hundred renders a day for the whole account. Three things
follow. Sessions are reused across invocations with `puppeteer.sessions()` and
`connect()`, because an upload arriving 10 seconds after another cannot open a
browser of its own. Uploads pre-render in `ctx.waitUntil`, capped per upload,
and log what they defer. An on-demand render that cannot get a browser serves
the live client-side shell and logs it, never a 500: a missing PDF is a worse
day than a broken one.

**A deck PDF is a different document from the live deck shell.** `render.js`
shows one slide at a time behind a `.current` class, so printing the live shell
would yield a one-page PDF. The print HTML renders every slide visible, one per
page, at a 1152x648 page box matching Marpit's 16:9 slide. The document shape
uses `public/print.css`: A4, real margins, `.theme-light` surfaces because a PDF
gets printed and forwarded, and a page number from Chrome's `footerTemplate`
rather than `@page`, because headless Chrome implements no CSS Paged Media
margin box.

**`.html` is a snapshot, not the live shell.** It has to open from a mail
attachment with no network, so the Worker inlines the CSS and the fonts as
`data:` URIs and the page removes its own script tags once they have run. One
page load yields both artifacts, `page.content()` and `page.pdf()`, which halves
the only budget that binds. Two consequences. `font-src 'self'` blocks `data:`
fonts, so the snapshot carries its own `SNAPSHOT_CSP` rather than loosening
`SHELL_CSP` for every shell page. All six woff2 would be 313 KB base64, so the
snapshot inlines four faces plus a ten-glyph Nunito subset: Nunito sets one
fixed string, the wordmark, while both italics earn their place because a
missing face is synthesized as a slanted upright rather than falling back
cleanly. That lands at 155 KB raw, roughly 207 KB base64.

**Cached artifacts can drift from the brand, and the cache version is the
answer.** Everything above this section renders client-side, which is why a
brand change ships to every artifact ever uploaded without re-rendering
anything. A cached PDF is the first thing in this system that breaks that:
hashes are immutable, so nothing ever invalidates one. Derived artifacts
therefore live under `d/v<N>/`, with `N` a constant in `src/lib/exportPath.ts`,
bumped whenever `tokens.css`, `nt-marp.css`, `print.css`, or the print HTML
changes. Old versions age out with their upload. This is a real weakening of the
client-side-rendering property, recorded here as one rather than discovered
later.

## Storage layout

```
<space>/<hash>/meta.json      access tier, expiry fields, lastAccess, uploader, file list
<space>/<hash>/f/<path...>    the bytes
<space>/<hash>/d/v<N>/...     derived exports, keyed by resolved shape
_trash/<space>/<hash>/...     soft-deleted uploads, purged by a lifecycle rule
```

Payload lives under `f/` so an upload named `meta.json` cannot shadow the record.
`d/` is reserved the same way, so an upload cannot pose as a derived artifact.
Derived artifacts never appear in `meta.json` `files[]` or the directory listing.
Delete and the nightly sweep both list the whole `<space>/<hash>/` prefix, so an
export trashes and purges with its upload and needs no bookkeeping of its own.
Metadata derives from R2 alone, so there is no second datastore to drift.

KV holds shortlinks only: `z/<id>` -> `{target, exp}` with `expirationTtl` set, so
the entry self-deletes.

## Access tiers

Set per upload in `meta.json`, overridable at mint time.

- `open` (default): the hash is the whole credential (R1).
- `signed`: a bare hash URL returns 401 with a branded page. Requires a valid
  `/k/<token>/` path segment (R5).
- Artifact expiry applies to either tier (R4). Past it the Worker 404s and the
  nightly sweep moves the bytes to `_trash/`.

### Token format

A path segment, `/k/v1.<exp>.<sig>/`, where
`sig = HMAC-SHA256(key_v1, "<space>/<hash>|<exp>")`, base64url, truncated to
128 bits. The token is 37 characters and a full signed URL runs about 98; a
shortlink hides it for pasting.

- `exp` is a unix timestamp inside the signed payload, so it cannot be edited
  without invalidating the signature.
- `exp=0` means no expiry, still signed.
- Verified with WebCrypto and a constant-time compare. Cheap enough for 10 ms.
- The key id lets you rotate the secret and let old links age out, or drop the old
  key and kill every outstanding link at once.
- The signature covers the `<space>/<hash>` prefix, not a single file, so one token
  admits the whole upload and every relative asset inside it (R10).

### Retention

- Default artifact life is 90 days from upload, fixed. A per-space map in config
  overrides it, so client spaces can run short and personal spaces long.
- `--ttl <duration|forever>` at upload sets a fixed expiry.
- `--ttl-idle <duration>` at upload expires the artifact that long after its last
  access instead. Only idle-TTL uploads pay the bookkeeping: `lastAccess` in
  `meta.json` is rewritten at most once per day per artifact.
- An R2 lifecycle rule cannot read a date out of `meta.json`; it only matches
  prefix plus object age. So a nightly cron-triggered sweep (free tier includes
  cron) walks `meta.json` records and moves expired uploads to `_trash/`. The one
  lifecycle rule sits on `_trash/` and purges it after 30 days.

### Four clocks

| Clock | Set at | Default | Enforced by |
| --- | --- | --- | --- |
| Artifact life | upload | 90 days, per-space override | `meta.json` + nightly cron sweep |
| Link life | mint | 30 days | `exp` inside the HMAC payload |
| Shortlink life | mint | matches its link | KV `expirationTtl`, self-deleting |
| Trash life | delete or expiry | 30 days | R2 lifecycle rule on `_trash/` |

## HTTP contract

```
POST   /up/<space>                    multipart or tar. Bearer. -> {url, hash, files[]}
POST   /sign                          Bearer. {path, ttl, short?} -> {url, short?, exp}
GET    /<space>/                      Bearer. JSON listing. 404 without it.
DELETE /<space>/<hash>/               Bearer. Soft delete. -> 204
GET    /<space>/<hash>/...            the artifact
GET    /<space>/<hash>/k/<token>/...  the artifact, signed tier
GET    /z/<id>                        302 to the signed URL
GET    /llms.txt                      the API, in plain text, for agents
GET    /SKILL.md                      a drop-in Claude skill
GET    /robots.txt                    Disallow: /
```

`/sign` requires Bearer like the writes: unauthenticated minting would let anyone
holding an expired link issue themselves a fresh one.

`DELETE` moves the upload to `_trash/<space>/<hash>/` rather than erasing it. The
upload token cannot purge, so a leaked or rogue token cannot wipe history. Trash
ages out on the 30-day lifecycle rule; an earlier purge is a dashboard action.

Uploaded file paths are normalized before they become R2 keys. A `..` segment or
an absolute path rejects the whole upload.

Auth is `Authorization: Bearer $SHARE_TOKEN`. The secret is a JSON map of
`name -> sha256(token)`, so revoking one person is a secret edit and every upload
records an uploader in `meta.json`.

Response shape follows `Accept`: JSON for agents, a bare URL for humans to paste.

Every response carries `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex`
(R2). Shell pages repeat it as a meta tag. `Cache-Control` stays at 10 minutes so a
revoke lands (R3).

## Upload surfaces

**curl.** The one line an agent copies (R12):

```
curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
  -F f=@out/report.html https://share.notambourine.com/up/acme
```

**Agents.** `/llms.txt` documents the API in plain text at a conventional path.
`/SKILL.md` serves a drop-in Claude skill. Both cover all five verbs: put, sign,
short, ls, rm. A repo that wants the capability carries a ten-line local stub whose
body fetches the hosted `SKILL.md`, so the server stays the single source of truth
and the skill never drifts across repos (R13).

**Token handling.** `SHARE_TOKEN` resolves from 1Password by `op://` reference.
`llms.txt` and `SKILL.md` both name this as the only sanctioned way to load it
(R14).

**CLI.** `bin/share.mjs`, Node, single file. Walks a directory, preserves relative
paths under the hash, prints the URL. Subcommands: `put`, `sign`, `short`, `rm`
(soft delete), and `ls` for a space, Bearer only (R15). `put` takes `--ttl` and
`--ttl-idle` from the Retention section.

## Repo layout

Sketch, superseded by the code once it exists.

```
src/worker.ts          router, host check
src/routes/            upload, serve, short, list, delete
src/sweep.ts           scheduled handler: expiry sweep into _trash/
src/render/shell.ts    branded shells: image, code, md, dir, 401, 404
src/lib/sign.ts        HMAC mint and verify
src/lib/keys.ts        slug generation, key parsing, path normalization
public/render.js       client-side highlight, markdown, deck render and nav
public/vendor/         highlight.js, marked, Marpit, pinned copies
public/                llms.txt, SKILL.md, tokens.css
bin/share.mjs           CLI
tests/                 vitest, pure units for sign, keys, negotiation, path safety
wrangler.jsonc         R2 + KV bindings, custom domain, cron trigger
```

## Brand coupling

The brand's golden set is `notambourine/claude`, plugin `nt-brand`, skill
`system`. This repo cannot fetch it at runtime - a self-only CSP forbids a CDN,
and Workers Builds deploys the tree with no build step - so `public/tokens.css`,
`public/vendor/marp/nt-marp.css`, and `public/fonts/*` are committed copies.

**A copy is only DRY if something fails when it drifts.** Three mechanisms, each
catching a different drift:

- `upstream/nt-brand` is a git submodule pinned to a commit of the golden set.
  `npm run vendor:brand` copies out of it. Dependabot's `gitsubmodule` ecosystem
  opens the bump PR, so an upstream correction arrives as a reviewable diff
  rather than as a value nobody re-typed.
- `npm run brand` re-runs that copy and then `git diff --exit-code -- public`.
  A file edited in place fails CI. This is the whole byte contract, offline, so
  no lock file records a hash that would itself go stale.
- `scripts/brand-audit.mjs` reads every color out of `tokens.css` and fails any
  other file naming a color outside that set. It covers what a byte-diff cannot:
  `shell.css`, `print.css`, `nt-code.css`, `favicon.svg`, and the print footer in
  `export.ts` are this repo's own CSS, and a hand-picked hex there renders close
  enough to survive review.

A Dependabot bump PR goes red on the second mechanism until someone runs
`npm run vendor:brand` on that branch. That is the intended signal, not a gap:
the pointer and the bytes land in one commit or neither does.

## Build order

1. Repo, wrangler config, R2 bucket, KV namespace, `share.notambourine.com` custom
   domain, secrets set in the dashboard.
2. Serve path, `open` tier only. Hand-seed one object in R2 and prove negotiation,
   headers, and the branded image shell.
3. Upload path, Bearer auth, `meta.json`, CLI `put`.
4. Signing, the `signed` tier, the 401 page.
5. Shortlinks in KV.
6. Soft delete, `ls`, the cron sweep, the `_trash/` lifecycle rule.
7. Client-side renderers: code, then markdown, then slides.
8. `llms.txt`, `SKILL.md`, the local skill stub.
9. Deploy via Cloudflare git integration, mirroring the site's setup.

## Decisions

**Subdomain, not a separate domain.** A separate short domain has the shape of
phishing, and the audience is trained to distrust it. Brand credibility in the URL
is the point. The isolation a separate domain buys is thinner than it looks:
subdomain and apex are already separate origins, so `localStorage`, `fetch`, and
the DOM are walled off. What same-site actually grants an attacker is cookie
tossing, setting a cookie scoped to `Domain=notambourine.com` that the marketing
site then receives. The site sets no cookies, and the rule is to keep it that way.

The version worth buying is the GitHub split, `github.com` renders and
`githubusercontent.com` serves untrusted bytes. Revisit the day this host serves
something nobody on the team wrote. The change is a second binding and a base URL
constant in `render/shell.ts`, not a rewrite.

**Signed links, not Cloudflare Access.** Uploaded JS runs on this host. An Access
`CF_Authorization` cookie would be an ambient credential sitting on the same origin
as hostile script. A signature in a URL is not ambient, so a hosted script cannot
lift it and replay it. The cost is no per-viewer audit trail, accepted for now.

**Token in the path, not the query string.** Relative URLs drop a query string, so
a `?k=` on a signed `index.html` would 401 every asset the page loads. A `/k/...`
segment above the filename rides along on every relative fetch. Same 37 characters
either way, and the path form covers single files too, so there is one mechanism.

**Soft delete, no per-link denylist.** Revoking means `rm` (to `_trash/`) or key
rotation; re-share by re-uploading under a fresh hash. A denylist would buy
per-link revocation at the cost of a KV read on every signed request, and the goal
is one link to one person, so deletion already matches the real case. Soft delete
means a leaked upload token can hide material for 30 days but never destroy it.

**Bearer header, not a query token.** An earlier version of this idea fed Shottr
through a custom `uploadEndpoint`, and Shottr cannot send headers, which forced the
token into the query string and into request logs. Nothing in the chosen v1 has
that limit. If Shottr is ever added, it gets its own query-token route and its own
scoped credential, not a shared one.

## Risks

- **Uploaded JS runs on the host.** Contained by having no ambient credential on
  the origin, which is the reason Access stays off this hostname. Add
  `Cross-Origin-Resource-Policy` and a CSP on shell pages.
- **SVG executes when served inline.** Never `Content-Type: image/svg+xml` on a
  navigation. Attachment for raw, `<img>` inside the shell for the view.
- **A shortlink redirect exposes the signature** in the address bar. Accepted: the
  recipient holds it anyway, and folder artifacts need the real prefix for their
  relative assets.
- **`llms.txt` and `SKILL.md` are public** and describe an authenticated API. Fine
  by design. They must not name the space list.
- **10 ms CPU.** The Worker routes, verifies one HMAC, and fills a template.
  Anything heavier belongs in the browser or the CLI.

## Cost

Free at this volume. R2 gives 10 GB-month, 1M Class A, 10M Class B, egress free.
Workers free gives 100k requests/day and 10 ms CPU per request, and cron triggers
are included. KV free gives 100k reads and 1k writes/day, and only shortlinks touch
KV. The nightly sweep and the once-a-day `lastAccess` writes sit well inside the
Class A budget.

Browser Rendering is the one line item with a tight ceiling: 10 browser-minutes
a day across the account. Exports are built to spend fewer of them rather than
to buy more, and they degrade to the client-side shell when the budget is gone.
