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
- Every HTML page comes from `layout()` (`src/render/shell.tsx`), the landing page
  included. Never add a second page under `public/`.
- `hono/jsx` escapes every filename; never escape by hand, and use `raw()` only for
  values that are already markup.
- Precedence in `src/worker.ts` is the security model: an uploaded file named
  `config`, `admin`, or `generate` keeps its GET. Never move that dispatch into a
  route matcher. `htmlResponse()` (`src/lib/http.ts`) owns the CSP and `Vary`.
- `src/client/` carries the DOM lib, never `@cloudflare/workers-types`, and may
  import from `src/lib/`.

## Storage model

- Nothing renders or generates at upload; an html view renders per request and
  stores nothing. Only `.pdf` and `.png` reach `BROWSER` and cache under `d/v<N>/`
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

## Working page and generation

- It generates by submitting a real form into a new tab and the route answers
  `303`. Never add a fetch that reports completion, and never a GET that generates;
  a scanner would prefetch it and spend a model call.
- It is the one shell served `form-action 'self'` (`ADMIN_CSP`); every other shell
  hosts uploaded HTML and keeps `'none'`.
- `src/transforms/` holds the format server-side; never publish a formatting skill
  for uploaders. `MAX_TRANSFORM_BYTES` refuses rather than truncates.
- A prompt or model edit runs `npm run evals` by hand before shipping. CI never
  runs it.

## Security

- The unguessable hash is the only credential a reader needs, so these
  prohibitions are the entire protection story.
- Never put Cloudflare Access on this hostname; uploaded JS runs here and could
  replay a `CF_Authorization` cookie.
- Never set a cookie on `notambourine.com` or any subdomain.
- Never reintroduce a view token or locked tier.
- `authorize()` (`src/lib/auth.ts`) is the one Bearer gate. Two credentials exist:
  the vault token, which only mints, and the 5-minute artifact-scoped `?c=`.
- Never generate or echo a raw bearer token; that is terminal-only work via
  `scripts/add-employee.sh`.
- Cloudflare secrets are write-only; the 1Password vault is the source of truth and
  `TOKENS` derives from it, never hand-edited.
- Bound the paid bindings by count, never by trust: `?c=` signed over its session's
  first mint and cut at `ADMIN_SESSION_SECS`; `MAX_VERSIONS` per generation name,
  counted by listing before the model call; one render per `ATTEMPT_SECS`, claimed
  by a marker written before the browser opens. Keep every bound a listing or an
  object the delete and sweep prefixes cover; never a counter in `meta.json`.
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
- Dashboard setup: README.md "Setup from zero". Tokens: `scripts/add-employee.sh`,
  whose header is the runbook.
