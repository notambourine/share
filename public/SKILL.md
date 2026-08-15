---
name: share
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory, or to list or revoke existing shares.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl, `<img src>`, and Slack unfurls get raw bytes from the same URL.

## Token

`SHARE_TOKEN` resolves from 1Password by `op://` reference. Never echo it,
never put it in a query string, never commit it. The convention: every team
member keeps their token in their built-in Employee vault as an item titled
`share-token` with the value in a field named `credential`, so one reference
works for everyone and nothing lives on disk. Run every verb below under
this prefix — `op run` resolves the reference from the environment and the
secret exists only inside the wrapped command:

    SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c '<verb>'

Single quotes on the inner command matter: they keep your shell from
expanding `$SHARE_TOKEN` to nothing before `op run` injects it.

## Preflight

Before the first verb, confirm the machine is wired:

    op read op://Employee/share-token/credential >/dev/null 2>&1 && echo ready

If not ready, stop and walk the user through one-time setup — do not attempt
an upload, and never accept a raw token into the conversation:

1. They get a token from whoever runs the share repo (minted by
   `scripts/add-employee.sh`, delivered as a view-once 1Password link).
2. They save it per the Token section above (Employee vault, item
   `share-token`, field `credential`).
3. Re-run the check.

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
  Decks run through Marp, so `---` splits slides and Marp directives work:
  `<!-- _class: lead -->` for a title slide, `<!-- paginate: true -->` for
  slide numbers.
- Full API: https://share.notambourine.com/llms.txt
