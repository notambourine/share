# share/: operating context

## Build and deploy

- Workers Builds deploys on push to `main`. Never run `wrangler deploy` or `dev`.
- Verify with `npm run oxlint`, `npm test`, `npm run types`, `npm run
  build:client`, `npm run brand`, in that order; CI runs the same five.
- `build:client` is every write into `public/`, all gitignored. Run it before
  `brand`, which hashes what it wrote.
- Dependency gates ride the org Socket app. Never add vet/guarddog/socket-tree to CI.

## Rendering

- Everything renders in the Worker (`src/render/`). Never add a parser under
  `public/` or a second render path; `src/client/` holds interaction only.
- A page arrives as markup on the GET. Never fill a shell with a `?raw` fetch and
  never poll.
- Mermaid is `src/render/mermaid.ts` over `beautiful-mermaid`; upstream mermaid
  measures through `getBBox()`, so never reach for it. Its colors are `var()`s off
  the golden set, and none may name the token it sets.
- A `.csv` or `.tsv` renders as a grid: the Worker parses it (`src/render/csv.ts`)
  and ships the first 50 rows as markup plus every row as a
  `<script type="application/json">` data block, which Tabulator reads in
  `src/client/table.ts`. That block is the one page whose rows the client draws;
  it still arrives on the GET, so the no-fetch and no-poll rules hold. Never swap
  it for a fetch, and never let the static rows go — they are the fallback when a
  decode fails. Tabulator's stock themes are hardcoded hex and never ship;
  `public/nt-table.css` is the golden-set port that `npm run brand` gates.
- Every HTML page comes from `layout()` (`src/render/shell.tsx`), the landing page
  included. Never add a second page under `public/`.
- `hono/jsx` escapes every filename; never escape by hand, and use `raw()` only for
  values that are already markup.
- Every write lives under `/up/` or `/admin/`, the two prefixes Access guards; a
  share's own path answers GET and HEAD only. Never add a write route outside
  them. `htmlResponse()` (`src/lib/http.ts`) owns the CSP and `Vary`.
- `src/client/` carries the DOM lib, never `@cloudflare/workers-types`, and may
  import from `src/lib/`.

## Storage model

- Nothing renders or generates at upload; an html view renders per request and
  stores nothing. Only `.pdf` reaches `BROWSER` and caches under `d/v<N>/`
  behind a hand-bumped `CACHE_VERSION`.
- A generation writes `<name>.<epoch>.md` into `f/` and must never touch
  `meta.json`; that read-modify-write would drop a concurrent run's row.
  `meta.files` records what was *uploaded*; anything else under `f/` is a
  generation, read by `listGenerated` (`src/lib/r2.ts`). Renders come from
  `readRenders` (`src/lib/artifact.ts`).
- A bare `<name>.md` or `.pdf` resolves to the highest epoch by listing. Never
  overwrite a version and never add a pointer object; an older stamp keeping its own
  URL is what makes re-generating safe on a link already sent.
- Retention is per artifact, so no config file or secret holds a space name.
- Clients, repos, and prompts live in R2 under `_config/` (`src/shipped/`),
  never in this repo; the sweep skips that prefix like `_trash/`.

## Working page and generation

- It generates by submitting a real form into a new tab and the route answers
  `303`. Never add a fetch that reports completion, and never a GET that generates;
  a scanner would prefetch it and spend a model call.
- It is the one shell served `form-action 'self'` (`ADMIN_CSP`); every other shell
  keeps `'none'`.
- `src/transforms/` holds the format server-side; never publish a formatting skill
  for uploaders. Saved prompts join the system message after `SYSTEM`, which
  still outranks them. `MAX_TRANSFORM_BYTES` refuses rather than truncates.
- A prompt or model edit runs `npm run evals` by hand before shipping. CI never
  runs it.

## Security

- The unguessable hash is the only credential a reader needs; Cloudflare Access
  (Google SSO) is the only credential a writer needs. No token, key, or secret
  of ours exists for auth, and none may be added; the GitHub App key only reads.
- Access covers `/up/*` and `/admin/*` only, never the whole hostname: readers
  are clients without SSO. `authorize()` (`src/lib/auth.ts`) re-verifies the
  Access JWT on every write and refuses a cross-origin `Origin`.
- The SSO cookie shares this origin with uploads, so nothing uploaded may run
  here. Uploads pass `isUploadable()` (`src/lib/keys.ts`): never admit HTML,
  never serve a code file as anything but `text/plain`, and keep `nosniff` on
  raw bytes.
- `workers_dev` and `preview_urls` stay off; either would reach the write routes
  around Access.
- Never set a cookie of our own on `notambourine.com` or any subdomain.
- Bound the paid bindings by count, never by trust: `MAX_VERSIONS` per generation
  name, counted by listing before the model call; one render per `ATTEMPT_SECS`,
  claimed by a marker written before the browser opens. Keep every bound a
  listing or an object the delete and sweep prefixes cover; never a counter in
  `meta.json`.
- This repo is public. Client names never enter it; examples use `acme`.

## Brand

- The golden set is `@notambourine/brand-kit`, pinned exact; the Worker serves its
  `tokens.css` and `deck.css` at `/tokens.css` and `/vendor/marp/nt-marp.css`.
  Never copy them under `public/`; fix the value in that repo, publish, bump here.
- Every color must be one the golden set defines, including inside a `var()`
  fallback, and every `var(--x)` must read a token it still declares. `npm run
  brand` gates it.
- `npm run vendor` writes `public/fonts/*` and `public/logo/*`, both gitignored.
  Never hand-edit, hand-add, or commit a file there.
- `/favicon.svg`, `/favicon.ico`, and `/apple-touch-icon.png` are Worker aliases
  onto `public/logo/`, never second copies.
- Never typeset the brand name as display type; headers inline `LOCKUP` from
  `src/brand.ts`, and nothing here loads Nunito.

## Skills and runbooks

- `skills/share/SKILL.md` is the only copy and `src/skill.ts` serves it at
  `/SKILL.md`. Never add a copy under `public/`.
- `skills/` is the published plugin surface. Never vendor a third-party skill tree.
- Dashboard setup, Access included: README.md "Setup from zero".
