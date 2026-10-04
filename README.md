# share

`share.notambourine.com`: private artifact sharing for [NoTambourine](https://notambourine.com)
engagements. One upload in, one branded unguessable URL out.

```
nt-share put acme out/report.md
```

One URL, three answers. A browser gets a branded page: markdown as a deck or a
document decided from its own content, code highlighted, a csv as a grid.
`<img src>` and curl
get raw bytes. An unfurl crawler, split off by User-Agent because Slack asks
exactly like curl, gets the shell for its `og:` tags so a link draws a card;
images keep the bytes, since Slack renders those itself. Video has no frame a
Worker could cut, so `nt-share put` cuts one at upload. Markdown URLs also take
`deck.pdf`.

Upload answers a second link on stderr: the **working page** under `/admin/`,
where a sender ticks which uploaded files feed a generation, moves the expiry, or
deletes the share. A generation lands stamped (`deck.<epoch>.md`) and the bare
`deck.md` follows the newest stamp, so re-generating never moves a link already
sent. Every share's root is an **index page** of sources, versions, and renders:
HTML, or JSON on `Accept: application/json`.

**What shipped** (`/admin/shipped`, or `nt-share shipped <client>`) reads a
client's merged PRs and releases for the last 24 hours, 7 days, 30 days, or last
calendar month, and writes an agenda or slides into a new share; `.pdf` on the
result is the PDF. Clients, their repos, and the system and per-client prompts
(rules plus finished examples to match) live in R2 under `_config/`, edited at
`/admin/config`, because client names never enter this repo.

## How it holds together

- **Cloudflare Worker + R2**, free tier. Everything renders in the Worker on the
  GET; client bundles carry interaction only, and no CDN script runs on a host
  that serves client material.
- **The hash is the read credential.** 12 base62 chars (~71 bits), never
  enumerable, never indexed. Nothing else gates a read.
- **Cloudflare Access gates every write.** Google SSO covers `/up/*` and
  `/admin/*`; the Worker re-verifies the Access JWT. No tokens, no secrets.
- **Uploads are inert.** No HTML, code served as plain text, `nosniff` on bytes,
  so nothing uploaded runs on the origin the SSO cookie lives on.
- **Everything expires.** Artifacts default to 90 days; deletes are soft into
  `_trash/` and a nightly cron sweeps.

## API and CLI

`GET /llms.txt` documents everything in plain text. `GET /SKILL.md` is a drop-in
Claude skill, served from the bundle so it cannot drift from the installed copy.
`cli/share.ts` is the CLI (`install`, `put`); the terminal only uploads, because
everything else is on the working page. It signs in through `cloudflared`.

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
3. **Custom domain**: add `share.notambourine.com` under Domains & Routes.
4. **Access**: Zero Trust → Access → Applications → Self-hosted. Destinations
   `share.notambourine.com/up/*` and `share.notambourine.com/admin/*`, Google as
   the identity provider, one Allow policy on emails ending in
   `@notambourine.com`. Copy the app's AUD tag and team domain into `vars` in
   `wrangler.jsonc`.
5. **GitHub App key**: secret `GITHUB_APP_PRIVATE_KEY`, the `notambourine-velocity`
   App's key as PKCS#8 PEM (the same value `../site` holds). Only `/admin/shipped`
   reads it.

Browser Rendering needs no step; the `browser` binding is the whole setup. The
free plan's 10 browser-minutes a day account-wide is the constraint on PDF
exports, not CPU: the ceiling is near a hundred renders a day, and past it export
URLs serve the shell.

## Develop

```
npm ci
npm test        # vitest: path safety, negotiation, auth, versioning
npm run oxlint  # oxlint plus the vendored anti-slop rules in tools/oxlint/
npm run types   # tsc --noEmit, Worker and CLI (cli/ runs as .ts, node 22.18+ strips the types)
npm run build:client  # writes public/: the page bundles, plus fonts/ and logo/ from the brand dep
npm run brand   # gate: public/ holds what @notambourine/brand-kit ships, colors and tokens too
```

`public/fonts/`, `public/logo/`, and the three page bundles are build output, not
checked in. Run `build:client` before `brand`, the order CI uses. Deploys ride
Workers Builds on push to `main`; there is no manual deploy step.
