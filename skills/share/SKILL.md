---
name: share
version: 0.17.0
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory, or to list or revoke existing shares.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl and `<img src>` get raw bytes from the same URL. Pasted in Slack,
an image previews on its own and everything else draws a card - a video shows
the frame the CLI cut at upload.

## Verbs

    nt-share put <space> <file|dir ...> [--tier signed] [--ttl <dur>|forever]
                                        [--sign-ttl <dur>]
                                        [--transform agenda|renewal|performance|presentation|deck]
    nt-share put <space> --clip [--name shot.png]        # the image on the clipboard
    nt-share sign <space>/<hash> [--ttl <dur>]           # re-sign an older artifact
    nt-share admin <space>/<hash>                        # re-open the 5-minute admin link
    nt-share check <space>/<hash> [--json]               # renders landed, and whether a slide clips
    nt-share fix <space>/<hash> [--tier signed]          # trim the slides that clip; lands a new link
    nt-share ls <space> [--json]                         # every share, with each artifact's spellings
    nt-share rm <space>/<hash>                           # revoke; lands within 10 min

A `<dur>` is a number plus `m`, `h`, `d`, or `w`: `7d`, `12h`, `4w`. Defaults:
`--ttl 90d`, `--sign-ttl 30d`. A share expires on a fixed date; the admin page's
chips move it.

`put` prints the URL to hand over - the signed one when the tier is signed, so
there is no second call. On stderr it adds `admin (5 min): <url>`, the sender's
link to adjust the TTL or delete: it carries a write credential (`?c=`) and
never goes to the recipient. `nt-share admin` re-opens it after the window.
A folder keeps its relative paths, and one with an
`index.html` serves as a real page. A folder holding exactly one file and no
`index.html` links straight at that file rather than at a one-row index;
anything else links the folder root. An empty folder is a 400.

`ls` prints one block per artifact, newest first: the URL, tier, and size, then
every spelling each renderable file answers to. `--json` gives the rows raw -
`hash`, `url`, `tier`, `uploader`, `createdAt`, `expiresAt`, `expired`, `files`
(count), `bytes`, and `sources` (the paths that export). Read `expiresAt` there
to confirm a TTL; do not curl the artifact.

`--clip` uploads the image sitting on the OS clipboard as a PNG, no file on
disk: use it when someone says "share this screenshot" and names no path. It
reads the clipboard of the machine the CLI runs on, so it does nothing for an
image pasted into this conversation - write that to a file and upload the file.
"no image on the clipboard" means the copy did not take; say so and stop.

Run the verb you need and nothing else. The CLI raises the 1Password prompt
itself, caches a short-lived upload token in a mode-0600 file, and re-mints it
on expiry. Never wrap a call in `op run`, never pass a token, and never probe
with `op read`, `op whoami`, `op item get`, or `which op` - each costs an extra
unlock and proves nothing the verb does not.

## Setup

`nt-share` ships with this plugin. When `command -v nt-share` finds nothing,
ask before installing - it writes to `~/.local/bin` - then run:

    node "$(ls ~/.claude/plugins/cache/*/nt-share/*/bin/share.* 2>/dev/null | head -1)" install

The install is a no-op to re-run and prints its target on stderr; stdout stays
empty. If the glob finds nothing, this doc was fetched without the plugin: use
the HTTP API at https://share.notambourine.com/llms.txt instead.

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
- `--transform <name>` reformats each uploaded `.md`/`.txt` server-side
  (Workers AI) before it stores: hand it raw notes, a commit log, or a
  transcript and the link serves the finished document. The server owns the
  format, so never pre-format the file yourself - upload the raw material.
  `agenda`, `renewal`, and `performance` come out as documents;
  `presentation` and `deck` as Marp decks. A `.txt` is stored as `.md`. On a
  502, retry once without the flag and say the transform failed.
  It reformats and does not rewrite: the prompt asks for the author's own
  sentences to survive, so what comes back should still sound like the notes
  that went in. If it reads rewritten, that is a prompt bug worth reporting,
  not something to fix by pre-formatting.
- Markdown renders as a deck when the content says so - `marp: true` or `---`
  separators - and as a document otherwise; `.doc.html` and `.slides.html` pin
  it either way. Decks run through Marp, so `---` splits slides and Marp
  directives work: `<!-- _class: lead -->` for the cover, `divider` for a
  section break, `quote` for a pull quote, `split` to run a list in two
  columns, `<!-- paginate: true -->` for slide numbers, and
  `<!-- footer: acme -->` for a running footer. `<p class="eyebrow">01 &middot;
  the model</p>` gets the numbered pink label - write it in sentence case, the
  theme does the capitals. Every slide carries the lockup already, so never
  write a `<style>` block or pick a colour: a share is immutable, and a hex
  typed into a deck is a brand value nothing can correct later.
- A ```mermaid fence is drawn server-side, in brand colors, on the page and in
  the PDF: flowchart, sequence, state, class, ER, and xychart. Other types
  (pie, gantt, mindmap) show their source instead, so pick one of the six.
  Every other fence comes out highlighted; tag it with its language.
- Full HTTP API: https://share.notambourine.com/llms.txt

## Export formats

Swap the extension on a markdown share URL: uploaded `deck.md`, ask for
`deck.pdf`. The suffix decides the output, so `Accept` gets no vote, and a
file uploaded under the suffixed name wins.

| URL | Output |
| --- | --- |
| `deck.md` | branded page, deck or document from the content |
| `deck.txt` | the source, `text/plain`, always |
| `deck.slides.html` | branded page, always a deck |
| `deck.doc.html` | branded page, always a document |
| `deck.pdf` | PDF, deck or document decided from the content |
| `deck.slides.pdf` | PDF, always a deck |
| `deck.doc.pdf` | PDF, always a document |

Bare `.md` and `.pdf` read the content to choose: `marp: true` front matter or
`---` slide separators mean deck, anything else means document. You cannot guess
a sniff, so send `.slides.*` or `.doc.*` when the mode matters.

The artifact root lists every spelling beside each file, and `nt-share ls
<space>` prints the same set per artifact, so a recipient picks a mode instead
of guessing what a bare `.md` sniffs to.

The `.html` spellings answer immediately - the Worker renders them per request.
Only the PDFs go through a browser.

The deck theme is `deck.css` from the brand kit, the same bytes `nt-brand:system`
hands a local `marp` run, so a deck shared here and one built by hand come out
the same. Upload the markdown; do not render it first.

Attach `deck.pdf` to an email; send `deck.slides.html` when the recipient
should click through the deck. A PDF is rendered by the first request that asks
for it, so that one can take a few seconds; a 202 answer means it is still
rendering and lands on its own. Hand the URL over as `put` printed it - never
curl the suffixes to check they respond.

Run `nt-share check <space>/<hash>` after sharing a deck: it names the slides
whose content clips and exits 1 when any does. It exits 2 while a render is
still `(pending)`, because nothing measured is not the same as nothing wrong:
rerun `check` until it exits 0.

When it does clip, `nt-share fix <space>/<hash>` trims those slides and nothing
else. It re-uploads the artifact whole through a repair prompt allowed to cut
only the slides `check` named, and prints a new link. A share is immutable, so
the fix is always a new URL - the old link keeps working until you `rm` it,
which is what makes this safe to run on a deck already sent. Hand over the new
link, then `rm` the old artifact. The tier carries over unless `--tier` says
otherwise.

Edit the source and `put` a fresh deck instead when the slide needs different
words rather than fewer.
