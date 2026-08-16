# share

`share.notambourine.com`: private artifact sharing for [NoTambourine](https://notambourine.com)
engagements. One curl line in, one branded unguessable URL out.

```
curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
  -F f=@out/report.html https://share.notambourine.com/up/acme
```

The same URL renders a branded page in a browser and serves raw bytes to
everything else: `<img src>`, Slack unfurls, curl. Markdown renders as a
document (`?slides` makes it a deck), code gets syntax highlighting, and a
folder upload with an `index.html` serves as a real page with its relative
assets intact.

A markdown URL also takes a format suffix: `deck.md.pdf` for a branded PDF,
`deck.md.html` for a self-contained page that opens from a mail attachment,
`deck.md.slides.pdf` and `deck.md.doc.pdf` to name the mode yourself.

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
  secret too. The source being public costs nothing; the URLs are the locks.

## API

`GET /llms.txt` documents everything in plain text. `GET /SKILL.md` is a
drop-in Claude skill. `bin/share.ts` is the CLI (`install`, `session`, `put`,
`sign`, `short`, `ls`, `rm`); `install` puts it on PATH as `nt-share`, so the
skill can call it by name.

`install` writes three files into the target dir: `nt-share.mjs` resolves the
newest installed plugin copy and imports it, so a plugin upgrade never strands
the entry point, and `nt-share` plus `nt-share.cmd` are one-line wrappers onto
it for sh and for cmd.exe. Both wrappers land on every platform, because one
home directory can be shared between Windows and WSL. Version comparison lives
in the resolver rather than a shell pipeline: `sort -V` has no cmd.exe
equivalent, and every plain string sort ranks `0.9.0` above `0.10.0`.

`nt-share put <space> --clip` uploads the image on the clipboard with no file
on disk: `osascript` on macOS, `Clipboard::GetImage` through PowerShell on
Windows, `wl-paste` or `xclip` on Linux. The bytes come back over stdout, so
nothing lands in a temp dir on the way.

A consumer carries only a stub, so the hosted skill stays the single source
of truth and never drifts. `GET /SKILL.md` is served from the bundle rather
than `public/`: `src/skill.ts` imports the skill file, so the served bytes and
the installed skill cannot diverge. The canonical stub lives at `skills/share/SKILL.md`,
which with `.claude-plugin/plugin.json` makes this repo an installable Claude
Code plugin: the org marketplace (`notambourine/claude-plugin`) lists it by
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

1. **R2 bucket**: create `notambourine-share` (name must match
   `wrangler.jsonc`). Add an object lifecycle rule: prefix `_trash/`, action
   *Delete objects*, age 90 days. Leave public access off; the Worker binding
   is the only read path; the bucket stays private.
2. **KV namespace**: create `share-links`, paste its namespace ID into
   `wrangler.jsonc` (`kv_namespaces[0].id`).
3. **Connect the repo**: Workers & Pages → Create → Workers → import this
   repository. Defaults are correct (deploy command `npx wrangler deploy`).
   Every push to `main` deploys; the cron trigger ships with the config.
4. **Secrets**: on the Worker: Settings → Variables and Secrets, each as type
   *Secret* (values are JSON strings; the Worker parses them):
   - `TOKENS`: map of name → sha256 of that person's bearer token. Built and
     reprinted by `scripts/add-employee.sh`; the 1Password vault is the source
     of truth and this secret is derived from it (Cloudflare secrets are
     write-only, so every change re-pastes the whole map).
   - `SIGNING_KEYS`: `{"v1":"<openssl rand -base64 32>"}`. Rotate by adding
     `v2` (new links mint with it, `v1` links still verify); delete an id to
     kill its outstanding links.
   - `SPACE_TTLS`: `{}`, later `{"<space>":<days>}` overrides. A secret
     because client names never enter this public repo.
5. **Custom domain**: Worker → Settings → Domains & Routes → add
   `share.notambourine.com`.

Browser Rendering needs no step of its own. The `browser` binding in
`wrangler.jsonc` is the whole setup, and the deploy applies it; there is no
account toggle to find and nothing to add under Settings → Bindings, which a
config-file Worker overwrites on every deploy anyway. What the free plan gives
is 10 browser-minutes per day account-wide, 3 concurrent browsers, one new
browser every 20 seconds, and a 60-second browser timeout. Browser minutes are
the constraint on PDF exports, not CPU: a few seconds per render puts the
ceiling near a hundred renders a day for the whole account, and past it export
URLs serve the browser-rendered shell instead of a PDF.

Team tokens (add, rotate, offboard, deliver): `scripts/add-employee.sh`: its
header is the runbook.

## Develop

```
npm ci
npm test        # vitest: signing, path safety, negotiation, auth
npm run oxlint  # oxlint plus the vendored anti-slop rules in tools/oxlint/
npm run types   # tsc --noEmit, Worker and CLI (bin/ runs as .ts, node 22.18+ strips the types)
npm run vendor  # refresh public/vendor/, fonts/, and logo/ after bumping a pin
npm run brand   # gate: those copies match upstream/brand-kit, colors and tokens too
```

Deploys ride Cloudflare Workers Builds on push to `main`; there is no manual
deploy step.
