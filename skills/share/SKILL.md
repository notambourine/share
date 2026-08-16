---
name: share
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory, or to list or revoke existing shares.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl, `<img src>`, and Slack unfurls get raw bytes from the same URL.

## Token

Two tokens exist. The **vault token** lives in 1Password (Employee vault,
item `share-token`, field `credential`) and never enters a transcript, a
query string, or a commit. The **session token** is what you actually use:
short-lived (15 minutes by default, 1 hour cap), minted from the vault token,
and safe to hold in the conversation because it expires on its own.

## Session (do this first)

Mint one session at the start; it is both the preflight and the only
1Password unlock the whole conversation needs. Single quotes on the inner
command matter: they keep your shell from expanding `$SHARE_TOKEN` to
nothing before `op run` injects it.

    SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c \
      'curl -sS -X POST -H "Authorization: Bearer $SHARE_TOKEN" \
        https://share.notambourine.com/session'

A `201` returns `{token, name, expiresAt}`. Each shell command runs fresh, so
carry the `token` value forward yourself: substitute it for `$SHARE_SESSION`
in every verb below. If a verb later returns 401 the session expired; mint a
new one (`?ttl=1h` stretches it for long jobs).

On failure, stop - do not attempt an upload, and never accept a raw vault
token into the conversation:

- `op read op://Employee/share-token/credential` fails -> one-time setup:
  they get a token from whoever runs the share repo (minted by
  `scripts/add-employee.sh`, delivered as a view-once 1Password link) and
  save it per the Token section. Re-run the mint.
- `op read` works but the mint returns `401 unauthorized` -> the Worker's
  `TOKENS` secret has drifted from the vault (a rotation that was never
  pasted). The share-repo admin re-runs `scripts/add-employee.sh --map`
  and re-pastes the printed map into the Worker secret.

## Verbs

Every verb takes the session token; `$SHARE_SESSION` below stands for the
literal `token` value from the mint. No `op run` prefix is needed again.

**put**: one file or a whole folder (relative paths survive; an `index.html`
makes the link serve as a real page):

    curl -sS -H "Authorization: Bearer $SHARE_SESSION" \
      -F f=@report.png https://share.notambourine.com/up/<space>

    # folder: one -F per file, filename carries the relative path
    curl -sS -H "Authorization: Bearer $SHARE_SESSION" \
      -F 'f=@dist/index.html;filename=index.html' \
      -F 'f=@dist/app.js;filename=app.js' \
      https://share.notambourine.com/up/<space>

Options: `?tier=signed` (viewing needs a minted key), `?ttl=7d|forever`
(default 90d), `?idle=14d` (expire after inactivity instead).
Add `-H "Accept: application/json"` for `{url, hash, files}`.

**sign**: mint a time-boxed link for a signed-tier artifact:

    curl -sS -H "Authorization: Bearer $SHARE_SESSION" -H "Content-Type: application/json" \
      -d '{"path":"<space>/<hash>","ttl":"30d"}' https://share.notambourine.com/sign

**short**: same call with `"short":true`; the response adds a `/z/<id>` URL.

**ls**: `curl -sS -H "Authorization: Bearer $SHARE_SESSION" https://share.notambourine.com/<space>/`

**rm**: `curl -sS -X DELETE -H "Authorization: Bearer $SHARE_SESSION" https://share.notambourine.com/<space>/<hash>/`
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

## Export formats

Append a suffix to a markdown share URL. The suffix decides the output, so
`Accept` gets no vote, and a file uploaded under the suffixed name wins.

| URL | Output |
| --- | --- |
| `deck.md` | branded document, rendered in the browser |
| `deck.md.slides.html` | branded deck, rendered in the browser (same as `?slides`) |
| `deck.md.html` | self-contained page, fonts inlined, opens offline |
| `deck.md.pdf` | PDF, deck or document decided from the content |
| `deck.md.slides.pdf` | PDF, always a deck |
| `deck.md.doc.pdf` | PDF, always a document |

Bare `.pdf` and `.html` read the content to choose: `marp: true` front matter
or `---` slide separators mean deck, anything else means document. You cannot
guess a sniff, so send `.slides.pdf` or `.doc.pdf` when the shape matters.

Attach `deck.md.pdf` to an email; send `deck.md.slides.html` when the recipient
should click through the deck. The first PDF request after an upload can take a
few seconds while the browser renders it.
