---
name: share
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory, or to list or revoke existing shares.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl, `<img src>`, and Slack unfurls get raw bytes from the same URL.

## Token

`SHARE_TOKEN` resolves from 1Password by `op://` reference. Never echo it,
never put it in a query string, never commit it. Run commands through
`op run --env-file <file>` so the secret stays out of the transcript.

## Verbs

**put** — one file or a whole folder (relative paths survive; an `index.html`
makes the link serve as a real page):

    curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
      -F f=@report.png https://share.notambourine.com/up/<space>

    # folder: one -F per file, filename carries the relative path
    curl -sS -H "Authorization: Bearer $SHARE_TOKEN" \
      -F 'f=@dist/index.html;filename=index.html' \
      -F 'f=@dist/app.js;filename=app.js' \
      https://share.notambourine.com/up/<space>

Options: `?tier=signed` (viewing needs a minted key), `?ttl=7d|forever`
(default 90d), `?idle=14d` (expire after inactivity instead).
Add `-H "Accept: application/json"` for `{url, hash, files}`.

**sign** — mint a time-boxed link for a signed-tier artifact:

    curl -sS -H "Authorization: Bearer $SHARE_TOKEN" -H "Content-Type: application/json" \
      -d '{"path":"<space>/<hash>","ttl":"30d"}' https://share.notambourine.com/sign

**short** — same call with `"short":true`; the response adds a `/z/<id>` URL.

**ls** — `curl -sS -H "Authorization: Bearer $SHARE_TOKEN" https://share.notambourine.com/<space>/`

**rm** — `curl -sS -X DELETE -H "Authorization: Bearer $SHARE_TOKEN" https://share.notambourine.com/<space>/<hash>/`
Revocation lands within 10 minutes.

## Conventions

- Space = client or person slug, lowercase (`acme`, `sara`). The space is
  visible in the URL, so pick the name you'd show the recipient.
- Client-facing material defaults to `?tier=signed`; internal scratch stays open.
- Markdown renders as a document; add `?slides` to the share URL for a deck.
- Full API: https://share.notambourine.com/llms.txt
