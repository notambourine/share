# share/: operating context

- Dependency gates (CVE, malware, tree scan) ride the org-level Socket app.
  Do not add vet/guarddog/socket-tree jobs to CI; their lights are silenced
  in `.claude/settings.json`.
- Deploys ride Cloudflare Workers Builds on push to `main`. Never run
  `wrangler deploy` or `wrangler dev`; verify with `npm run oxlint`, `npm test`,
  `npm run types`, then `npm run build:client` and `npm run brand`. CI runs the
  same five in that order.
- The deploy runs `npm run build:client`, which is every write into `public/`:
  it bundles `src/client/` into `public/render.js`, `public/admin.js`, and
  `public/print.js`, and copies `public/fonts/` and `public/logo/` out of the
  brand dep. All of it is gitignored, so a deploy that skips the build serves
  404 for every page script and a bare favicon. CI runs the same build as a
  gate, which works under `--ignore-scripts` because esbuild's native binary
  ships inside its platform package instead of being fetched by a postinstall.
  Run it before `npm run brand`, which hashes what it wrote.
- `src/client/` is browser code and carries the DOM lib, never
  `@cloudflare/workers-types`; `tsconfig.client.json` owns it and `npm run types`
  checks all three projects. It may import from `src/lib/` - that is the point,
  and it is why no client file restates `splitFrontMatter` or a JSON decoder.
- Markdown, decks, and highlighting render in the Worker, in
  `src/render/markdown.ts`, which the live shells and the print page both call.
  Never add a parser under `public/` or a second render path: a page arrives as
  markup, and `src/client/` holds interaction only - the deck nav and the copy
  button. Never reintroduce a `?raw` fetch to fill a shell.
- Nothing renders at upload. An html view is rendered by the request that asks
  for it and stores nothing, so a brand edit reaches every link ever made with
  nothing to invalidate. Only `.pdf` and `.png` reach the `BROWSER` binding, and
  only they cache under `d/v<N>/` behind a hand-bumped `CACHE_VERSION`.
- One-time dashboard setup: README.md "Setup from zero". Token add, rotate,
  offboard, and delivery: `scripts/add-employee.sh` (its header is the runbook).
- This repo is public. Client names never enter it; committed examples use
  `acme`. Retention is per artifact - `?ttl=` at upload, the admin page's
  chips after - so no config file or secret holds a space name.
- Cloudflare secrets are write-only. The 1Password vault is the source of truth
  for bearer tokens; the `TOKENS` secret is derived from it, never hand-edited.
- The brand's golden set is the `@notambourine/brand-kit` dependency, pinned
  exact. `src/brand.ts` imports `tokens.css` and `deck.css` from it and the
  Worker serves them at `/tokens.css` and `/vendor/marp/nt-marp.css`. Never add
  a copy under `public/`; correct a brand value in that repo, publish, and bump
  the version here.
- `public/fonts/*` and `public/logo/*` are the only brand files on disk, because
  a static server should serve a woff2, a png, and an .ico. `npm run vendor`
  writes both out of the dep during the build and empties them first; they are
  gitignored, so never hand-edit, hand-add, or commit a file there.
- Icons come from `public/logo/`. `/favicon.svg`, `/favicon.ico`, and
  `/apple-touch-icon.png` are Worker aliases onto it, never second copies.
- Never typeset the brand name as display type. `src/brand.ts` exports `LOCKUP`
  and every header inlines it, sized in CSS with `fill: currentColor`. That
  covers the shells and the PDF, so nothing here loads Nunito.
- Every HTML page comes from `layout()` in `src/render/shell.tsx`, the landing
  page included. Never add a second page under `public/`; it would carry a
  second copy of the header.
- The render layer is `hono/jsx`, so JSX escapes every filename it prints and no
  call site escapes by hand. `raw()` is the only opt-out and belongs to values
  that are already markup: the lockup, the inlined stylesheet, the rendered
  document or deck. Never reach for it to silence a `&amp;` that looks wrong.
- The Worker keeps its own router. Precedence in `src/worker.ts` is the security
  model - an uploaded file named `config`, `admin`, or `status` keeps its GET -
  so never move that dispatch into a route matcher. Responses keep coming from
  `htmlResponse()` in `src/lib/http.ts`, which owns the CSP and `Vary`.
- Every color in this repo must be one the golden set defines, including inside
  a `var()` fallback, and every `var(--x)` must read a token it still declares.
  `npm run brand` is the gate and CI runs it.
- `src/transforms/` is the `?transform=` upload feature: the format lives in
  those prompts, server-side, so never publish a formatting skill for uploaders
  to follow. A prompt or model edit runs `npm run eval:transforms` (live model,
  by hand, needs a Workers AI token) before it ships; CI never runs it.
- `skills/share/SKILL.md` is the only copy of the skill. `src/skill.ts` imports
  it to serve `/SKILL.md`; never add a copy under `public/`.
- `skills/` is the published plugin surface, and this repo holds no other
  skills. Never vendor a third-party skill tree here; that machinery lives in
  its own repo.
- `authorize()` in `src/lib/auth.ts` is the one Bearer gate: it owns which
  credential a verb takes (a session token only uploads), the `SIGNING_KEYS`
  500, and whether a refusal speaks JSON or text. A route calls it and returns
  the `Response` it may hand back; never re-derive that policy from
  `authenticate()`'s tri-state at a call site.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
- Never put Cloudflare Access on this hostname. Uploaded JS runs here, and an
  `CF_Authorization` cookie is an ambient credential a hosted script can replay.
  A signature in a URL is not ambient, which is why the signed tier is the lock.
- Never set a cookie on `notambourine.com` or any subdomain. `share` is
  same-site with the marketing site, so a `Domain=notambourine.com` cookie set
  here reaches it. That the site sets none is what makes the shared apex safe.
