# share/: operating context

- Dependency gates (CVE, malware, tree scan) ride the org-level Socket app.
  Do not add vet/guarddog/socket-tree jobs to CI; their lights are silenced
  in `.claude/settings.json`.
- Deploys ride Cloudflare Workers Builds on push to `main`. Never run
  `wrangler deploy` or `wrangler dev`; verify with `npm run oxlint`, `npm test`,
  and `npm run types`. CI runs the same three.
- One-time dashboard setup: README.md "Setup from zero". Token add, rotate,
  offboard, and delivery: `scripts/add-employee.sh` (its header is the runbook).
- This repo is public. Client names never enter it; per-space retention lives
  in the `SPACE_TTLS` Worker secret; committed examples use `acme`.
- Cloudflare secrets are write-only. The 1Password vault is the source of truth
  for bearer tokens; the `TOKENS` secret is derived from it, never hand-edited.
- The brand's golden set is the `upstream/brand-kit` submodule. `src/brand.ts`
  imports `tokens.css` and `deck.css` from it and the Worker serves them at
  `/tokens.css` and `/vendor/marp/nt-marp.css`. Never add a copy under
  `public/`; correct a brand value in that repo and bump the pin.
- `public/fonts/*` and `public/logo/*` are the only brand copies, because a
  static server should serve a woff2, a png, and an .ico. `npm run vendor`
  refreshes both from the submodule; never hand-edit or hand-add a file there.
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
  that are already markup: the lockup, the inlined stylesheet, the bootstrap
  script. Never reach for it to silence a `&amp;` that looks wrong.
- The Worker keeps its own router. Precedence in `src/worker.ts` is the security
  model - an uploaded file named `config`, `admin`, or `status` keeps its GET -
  so never move that dispatch into a route matcher. Responses keep coming from
  `htmlResponse()` in `src/lib/http.ts`, which owns the CSP and `Vary`.
- Every color in this repo must be one the golden set defines, including inside
  a `var()` fallback, and every `var(--x)` must read a token it still declares.
  `npm run brand` is the gate and CI runs it.
- `skills/share/SKILL.md` is the only copy of the skill. `src/skill.ts` imports
  it to serve `/SKILL.md`; never add a copy under `public/`.
- `skills/` is the published plugin surface, and this repo holds no other
  skills. Never vendor a third-party skill tree here; that machinery lives in
  its own repo.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
- Never put Cloudflare Access on this hostname. Uploaded JS runs here, and an
  `CF_Authorization` cookie is an ambient credential a hosted script can replay.
  A signature in a URL is not ambient, which is why the signed tier is the lock.
- Never set a cookie on `notambourine.com` or any subdomain. `share` is
  same-site with the marketing site, so a `Domain=notambourine.com` cookie set
  here reaches it. That the site sets none is what makes the shared apex safe.
