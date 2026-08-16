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
query string, or a commit. The **session token** is what uploads use:
short-lived (5 minutes by default, 1 hour cap), minted from the vault token,
upload-only, and cached to a mode-0600 file - the same pattern as the AWS
CLI's STS cache - so it stays out of the conversation too. Worst case for
an exfiltrated copy: a few minutes of uploads, nothing else.

## CLI

Plugin installs carry `$CLAUDE_PLUGIN_ROOT/bin/share.mjs`. Prefer it for every
verb: the cache modes, the mint guard, the dotfile filter, and the Windows path
handling are tested code there, and re-deriving them in curl can only lose.

    SHARE=$CLAUDE_PLUGIN_ROOT/bin/share.mjs   # test -f before relying on it
    SHARE_TOKEN=op://Employee/share-token/credential op run -- node "$SHARE" session
    node "$SHARE" put <space> <file|dir ...> [--tier signed] [--ttl 90d|forever]
    SHARE_TOKEN=... op run -- node "$SHARE" sign|short <space>/<hash> [--ttl 30d]
    SHARE_TOKEN=... op run -- node "$SHARE" ls|rm <space>[/<hash>]

The curl forms below are the fallback for a consumer that fetched this doc
without the plugin, so no `bin/` is on disk. Same API, same rules.

## Session (your first tool call)

Run the mint before anything else - before reading the file you are about to
share, and before any check that 1Password is installed, signed in, or holds
the item. Assume it is all there. `op run` raises its own unlock prompt, and
the 201 is the preflight: one call proves the vault path, the token, and the
Worker. Never probe first with `op read`, `op whoami`, `op item get`,
`op vault ls`, or `which op`; each costs a second unlock and proves nothing
the mint does not. Single quotes on the inner command matter: they keep your
shell from expanding `$SHARE_TOKEN` to nothing before `op run` injects it.

    mkdir -p ~/.cache/notambourine-share && chmod 700 ~/.cache/notambourine-share && \
    umask 077 && \
    SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c \
      'curl -sS -X POST -H "Authorization: Bearer $SHARE_TOKEN" \
        https://share.notambourine.com/session' \
      > ~/.cache/notambourine-share/session.json.tmp && \
    jq -e .token ~/.cache/notambourine-share/session.json.tmp >/dev/null && \
    mv ~/.cache/notambourine-share/session.json.tmp ~/.cache/notambourine-share/session.json && \
    jq '{name, expiresAt}' ~/.cache/notambourine-share/session.json \
    || cat ~/.cache/notambourine-share/session.json.tmp

A success prints `{name, expiresAt}`; the token stays in the mode-0600 file
and never reaches the conversation. A failure prints the error instead - the
`jq -e` guard catches a 200-shaped refusal, so a bad mint never overwrites a
working session. Every `put` reads the file fresh, so it works in any later
shell with no carrying. The commands assume a POSIX shell; on Windows run them
in Git Bash (which Claude Code uses there), and the `~/.cache` path applies on
every platform. A 401 that says `session expired` means exactly that; re-run
the mint (`?ttl=1h` stretches one for long batches). The session token
authorizes `put` only - `sign`, `ls`, and `rm` are rarer and sharper, so each
runs under the `op run` prefix with the vault token and costs its own unlock.

Diagnose from what the mint printed. Do not go probing, and never accept a raw
vault token into the conversation:

- `op` reports the item or vault missing -> one-time setup: they get a token
  from whoever runs the share repo (minted by `scripts/add-employee.sh`,
  delivered as a view-once 1Password link) and save it per the Token section.
  Re-run the mint.
- the mint returns `401 unauthorized` -> the Worker's `TOKENS` secret has
  drifted from the vault (a rotation that was never pasted). The share-repo
  admin re-runs `scripts/add-employee.sh --map --vault <admin-vault>` and
  re-pastes the printed map into the Worker secret. `--map` rebuilds `TOKENS`
  from the admin vault only, so if the re-paste does not clear the 401 the
  stale copy is the holder's own `Employee` item: rotate that name and
  redeliver.
- a `put` returns `401 only authorizes /up` -> a session token reached `sign`,
  `ls`, or `rm`. Those take the vault token under `op run`, never the cache.
- anything else -> stop and report it; do not attempt an upload.

## Verbs

`put` reads the cached session; the other verbs use `$SHARE_TOKEN` and run
under the same `op run` prefix as the mint.

**put**: one file or a whole folder (relative paths survive; an `index.html`
makes the link serve as a real page):

    curl -sS -H "Authorization: Bearer $(jq -r .token ~/.cache/notambourine-share/session.json)" \
      -F f=@report.png https://share.notambourine.com/up/<space>

    # folder: one -F per file, filename carries the relative path
    curl -sS -H "Authorization: Bearer $(jq -r .token ~/.cache/notambourine-share/session.json)" \
      -F 'f=@dist/index.html;filename=index.html' \
      -F 'f=@dist/app.js;filename=app.js' \
      https://share.notambourine.com/up/<space>

Options: `?tier=signed` (viewing needs a minted key), `?ttl=7d|forever`
(default 90d), `?idle=14d` (expire after inactivity instead).
Add `-H "Accept: application/json"` for `{url, hash, files}`.

**sign**: mint a time-boxed link for a signed-tier artifact (vault token):

    curl -sS -H "Authorization: Bearer $SHARE_TOKEN" -H "Content-Type: application/json" \
      -d '{"path":"<space>/<hash>","ttl":"30d"}' https://share.notambourine.com/sign

**short**: same call with `"short":true`; the response adds a `/z/<id>` URL.

**ls**: `curl -sS -H "Authorization: Bearer $SHARE_TOKEN" https://share.notambourine.com/<space>/`

**rm**: `curl -sS -X DELETE -H "Authorization: Bearer $SHARE_TOKEN" https://share.notambourine.com/<space>/<hash>/`
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
