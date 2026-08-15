# share

`share.notambourine.com` — private artifact sharing for [NoTambourine](https://notambourine.com)
engagements. One curl line in, one branded unguessable URL out.

```
curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
  -F f=@out/report.html https://share.notambourine.com/up/acme
```

The same URL renders a branded page in a browser and serves raw bytes to
everything else — `<img src>`, Slack unfurls, curl. Markdown renders as a
document (`?slides` makes it a deck), code gets syntax highlighting, and a
folder upload with an `index.html` serves as a real page with its relative
assets intact.

## How it holds together

- **Cloudflare Worker + R2 + KV**, free tier. The Worker routes, verifies one
  HMAC, and fills a template; rendering happens in the browser with vendored,
  pinned libraries (no CDN script on a host that serves client material).
- **The hash is the credential.** 12 base62 chars (~71 bits), never enumerable,
  never indexed (`X-Robots-Tag` on every response). Signed-tier artifacts also
  need an HMAC token carried as a `/k/<token>/` path segment, so relative
  assets inside a signed folder keep working.
- **Everything expires.** Artifacts default to 90 days, links to 30, deletes
  are soft into `_trash/` with a 90-day lifecycle purge. A nightly cron sweeps
  expired uploads.
- **No secrets in this repo.** Bearer tokens live as sha256 hashes in a Worker
  secret; signing keys rotate by key id; the per-space retention map is a
  secret too. The source being public costs nothing — the URLs are the locks.

`PLAN.md` is the pre-code decision record. The code is the source of truth for
anything they disagree on.

## API

`GET /llms.txt` documents everything in plain text. `GET /SKILL.md` is a
drop-in Claude skill. `bin/share.mjs` is the CLI (`put`, `sign`, `short`,
`ls`, `rm`).

A consumer carries only a stub, so the hosted skill stays the single source
of truth and never drifts. The canonical stub lives at `skills/share/SKILL.md`,
which with `.claude-plugin/plugin.json` makes this repo an installable Claude
Code plugin — the org marketplace (`notambourine/claude-plugin`) lists it by
reference, so one user-scope install works in every repo. A repo that wants
the capability without the plugin copies the same stub:

```markdown
---
name: share
description: Upload artifacts to share.notambourine.com and get a private branded link. Use when asked to share or send a file, folder, or screenshot, or to list or revoke shares.
---
Fetch https://share.notambourine.com/SKILL.md and follow it exactly.
```

## Setup from zero

One-time Cloudflare dashboard work, recorded for a rebuild or a new account.
Deploys themselves are hands-off after step 3.

1. **R2 bucket** — create `notambourine-share` (name must match
   `wrangler.jsonc`). Add an object lifecycle rule: prefix `_trash/`, action
   *Delete objects*, age 90 days. Leave public access off — the Worker binding
   is the only read path; the bucket stays private.
2. **KV namespace** — create `share-links`, paste its namespace ID into
   `wrangler.jsonc` (`kv_namespaces[0].id`).
3. **Connect the repo** — Workers & Pages → Create → Workers → import this
   repository. Defaults are correct (deploy command `npx wrangler deploy`).
   Every push to `main` deploys; the cron trigger ships with the config.
4. **Secrets** — on the Worker: Settings → Variables and Secrets, each as type
   *Secret* (values are JSON strings; the Worker parses them):
   - `TOKENS` — map of name → sha256 of that person's bearer token. Built and
     reprinted by `scripts/add-employee.sh`; the 1Password vault is the source
     of truth and this secret is derived from it (Cloudflare secrets are
     write-only, so every change re-pastes the whole map).
   - `SIGNING_KEYS` — `{"v1":"<openssl rand -base64 32>"}`. Rotate by adding
     `v2` (new links mint with it, `v1` links still verify); delete an id to
     kill its outstanding links.
   - `SPACE_TTLS` — `{}`, later `{"<space>":<days>}` overrides. A secret
     because client names never enter this public repo.
5. **Custom domain** — Worker → Settings → Domains & Routes → add
   `share.notambourine.com`.

Team tokens (add, rotate, offboard, deliver): `scripts/add-employee.sh` — its
header is the runbook.

## Develop

```
npm ci
npm test        # vitest: signing, path safety, negotiation, auth
npm run types   # tsc --noEmit
npm run vendor  # refresh public/vendor/ after bumping a pinned renderer
```

Deploys ride Cloudflare Workers Builds on push to `main`; there is no manual
deploy step.
