# share

`share.notambourine.com`: private artifact sharing for [NoTambourine](https://notambourine.com)
engagements. One curl line in, one branded unguessable URL out.

```
curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
  -F f=@out/report.html https://share.notambourine.com/up/acme
```

One URL, three answers. A browser gets a branded page: markdown as a deck or a
document decided from its own content, code highlighted, a folder with an
`index.html` as a real page with its relative assets intact. `<img src>` and curl
get raw bytes. An unfurl crawler, split off by User-Agent because Slack asks
exactly like curl, gets the shell for its `og:` tags so a link draws a card;
images keep the bytes, since Slack renders those itself. Video has no frame a
Worker could cut, so `nt-share put` cuts one at upload. Markdown URLs also take
`deck.pdf`, uploaded pages `page.pdf` and `page.png`.

Upload answers a second link on stderr, live five minutes: the **working page**,
where a sender ticks which uploaded files feed a generation, moves the expiry, or
deletes the share. A generation lands stamped (`deck.<epoch>.md`) and the bare
`deck.md` follows the newest stamp, so re-generating never moves a link already
sent. Every share's root is an **index page** of sources, versions, and renders:
HTML, or JSON on `Accept: application/json`.

## How it holds together

- **Cloudflare Worker + R2**, free tier. Everything renders in the Worker on the
  GET; client bundles carry interaction only, and no CDN script runs on a host
  that serves client material.
- **The hash is the credential.** 12 base62 chars (~71 bits), never enumerable,
  never indexed. Nothing else gates a read, which is what keeps a relative asset
  inside an uploaded folder working.
- **Everything expires.** Artifacts default to 90 days, the working page to five
  minutes; deletes are soft into `_trash/` and a nightly cron sweeps.
- **No secrets in this repo.** Bearer tokens live as sha256 hashes in a Worker
  secret and signing keys rotate by key id. The URLs are the locks.

## API and CLI

`GET /llms.txt` documents everything in plain text. `GET /SKILL.md` is a drop-in
Claude skill, served from the bundle so it cannot drift from the installed copy.
`bin/share.ts` is the CLI (`install`, `put`, `admin`); the terminal only uploads
and re-opens a working page, because everything else is on the page itself.

Consumers carry only a stub, so the hosted skill stays the single source of
truth. `skills/share/SKILL.md` plus `.claude-plugin/plugin.json` make this repo
an installable Claude Code plugin listed by the org marketplace; a repo that
wants the capability without the plugin copies the same stub:

```markdown
---
name: share
description: Upload artifacts to share.notambourine.com and get a private branded link. Use when asked to share or send a file, folder, or screenshot, or to list or revoke shares.
---
Fetch https://share.notambourine.com/SKILL.md and follow it exactly.
```

## Setup from zero

One-time dashboard work, recorded for a rebuild. Deploys are hands-off after
step 2.

1. **R2 bucket**: create `notambourine-share` (must match `wrangler.jsonc`). Add a
   lifecycle rule: prefix `_trash/`, *Delete objects*, 90 days. Leave public
   access off.
2. **Connect the repo**: Workers & Pages → Create → Workers → import this repo.
   The default `npx wrangler deploy` is correct, but the build command is empty
   and the Worker does not run without it: set Settings → Build → *Build command*
   to `npm run build:client`. Workers Builds ignores `build.command` in
   `wrangler.jsonc`, so this field is the only place the build lives.
3. **Secrets**: Settings → Variables and Secrets, type *Secret*, values as JSON.
   - `TOKENS`: name → sha256 of a bearer token, built by
     `scripts/add-employee.sh` from the 1Password vault. Secrets are write-only,
     so every change re-pastes the whole map.
   - `SIGNING_KEYS`: `{"v1":"<openssl rand -base64 32>"}`, signing the working
     page's `?c=`. Rotate by adding `v2`; delete an id to kill its outstanding
     tokens.
4. **Custom domain**: add `share.notambourine.com` under Domains & Routes.

Browser Rendering needs no step; the `browser` binding is the whole setup. The
free plan's 10 browser-minutes a day account-wide is the constraint on PDF
exports, not CPU: the ceiling is near a hundred renders a day, and past it export
URLs serve the shell.

## Develop

```
npm ci
npm test        # vitest: signing, path safety, negotiation, auth, versioning
npm run oxlint  # oxlint plus the vendored anti-slop rules in tools/oxlint/
npm run types   # tsc --noEmit, Worker and CLI (bin/ runs as .ts, node 22.18+ strips the types)
npm run build:client  # writes public/: the page bundles, plus fonts/ and logo/ from the brand dep
npm run brand   # gate: public/ holds what @notambourine/brand-kit ships, colors and tokens too
```

`public/fonts/`, `public/logo/`, and the three page bundles are build output, not
checked in. Run `build:client` before `brand`, the order CI uses. Deploys ride
Workers Builds on push to `main`; there is no manual deploy step.
