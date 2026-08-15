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

## Develop

```
npm ci
npm test        # vitest: signing, path safety, negotiation, auth
npm run types   # tsc --noEmit
npm run vendor  # refresh public/vendor/ after bumping a pinned renderer
```

Deploys ride Cloudflare Workers Builds on push to `main`; there is no manual
deploy step.
