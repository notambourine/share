---
name: share
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory, or to list or revoke existing shares.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl, `<img src>`, and Slack unfurls get raw bytes from the same URL.

## Verbs

    nt-share put <space> <file|dir ...> [--tier signed] [--ttl 90d|forever]
                                        [--ttl-idle 14d] [--sign-ttl 30d] [--short]
    nt-share sign <space>/<hash> [--ttl 30d] [--short]   # re-sign an older artifact
    nt-share ls <space>
    nt-share rm <space>/<hash>                           # revoke; lands within 10 min

`put` prints the URL to hand over - the signed one when the tier is signed, so
there is no second call. A folder keeps its relative paths, and one with an
`index.html` serves as a real page.

Run the verb you need and nothing else. The CLI raises the 1Password prompt
itself, caches a short-lived upload token in a mode-0600 file, and re-mints it
on expiry. Never wrap a call in `op run`, never pass a token, and never probe
with `op read`, `op whoami`, `op item get`, or `which op` - each costs an extra
unlock and proves nothing the verb does not.

## Setup

`nt-share` ships with this plugin. Put it on PATH once per machine; the call is
a no-op afterwards, so it is safe to prefix the first verb of a session with it:

    command -v nt-share >/dev/null || node "$(ls -d "$CLAUDE_PLUGIN_ROOT"/bin/share.ts \
      ~/.claude/plugins/cache/*/nt-share/*/bin/share.* 2>/dev/null | head -1)" install

If that glob finds nothing, this doc was fetched without the plugin: use the
HTTP API at https://share.notambourine.com/llms.txt instead.

## Failures

The CLI's message is the diagnosis; do not go probing, and never accept a raw
vault token into the conversation.

- **1Password cannot read the item** -> that person has no token yet. Whoever
  runs the share repo mints one with `scripts/add-employee.sh` and delivers it
  as a view-once link; it is saved at `op://Employee/share-token/credential`.
- **401, server rejects the token** -> the Worker's `TOKENS` secret has drifted
  from the vault (a rotation nobody pasted). The share-repo admin re-runs
  `scripts/add-employee.sh --map --vault <admin-vault>` and re-pastes the map.
  If that does not clear it, the stale copy is the holder's own vault item:
  rotate that name and redeliver.
- **anything else** -> stop and report it; do not retry the upload.

## Conventions

- Space = client or person slug, lowercase (`acme`, `sara`). The space is
  visible in the URL, so pick the name you'd show the recipient.
- Client-facing material takes `--tier signed`; internal scratch stays open.
- Markdown renders as a document; add `?slides` to the share URL for a deck.
  Decks run through Marp, so `---` splits slides and Marp directives work:
  `<!-- _class: lead -->` for a title slide, `<!-- paginate: true -->` for
  slide numbers.
- Full HTTP API: https://share.notambourine.com/llms.txt

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
