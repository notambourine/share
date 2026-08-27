---
name: share
version: 0.18.0
description: Share a generated artifact (report, code sample, deck, screenshot, folder, HTML prototype) as a branded unguessable link on share.notambourine.com. Use when the user asks to "share", "send", or "get a link for" a file or directory.
---

# share.notambourine.com

Upload an artifact, get one URL, hand it to one person. Browsers see a branded
render; curl and `<img src>` get raw bytes from the same URL. Pasted in Slack,
an image previews on its own and everything else draws a card - a video shows
the frame the CLI cut at upload.

## Verbs

    nt-share put <space> <file|dir ...> [--ttl <dur>|forever]
    nt-share admin <space>/<hash>            # re-open the 5-minute working page

A `<dur>` is a number plus `m`, `h`, `d`, or `w`: `7d`, `12h`, `4w`. Default
`--ttl 90d`. A share expires on a fixed date; the working page's chips move it.

`put` prints the URL to hand over on stdout. On stderr it adds
`working page (5 min): <url>`, the sender's own link: it carries a write
credential (`?c=`) and never goes to the recipient. `nt-share admin` re-opens it
after the window.

A folder keeps its relative paths, and one with an `index.html` serves as a real
page. A folder holding exactly one file and no `index.html` links straight at
that file rather than at a one-row index; anything else links the folder root.
An empty folder is a 400.

Run the verb you need and nothing else. The CLI raises the 1Password prompt
itself, once per run. Never wrap a call in `op run`, never pass a token, and
never probe with `op read`, `op whoami`, `op item get`, or `which op` - each
costs an extra unlock and proves nothing the verb does not.

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

## The working page

The `?c=` link `put` prints on stderr opens the sender's page for five minutes.
It is where the work happens, and it is the only place that writes:

- **Generate.** Tick which uploaded text files feed a generation, then pick
  `deck`, `agenda`, `renewal summary`, or `ship summary`. Several files compose
  into one document - notes plus a commit log plus a transcript is the normal
  case - and the result lands as a new version beside them. The server owns the
  format, so upload raw material and never pre-format it.
- **Expiry.** The chips move the date; links already sent inherit the change.
- **Delete.** Soft, into trash; the live link dies within 10 minutes.

Cmd+click a format card and the tab holds until the render lands, then it is
the artifact. Re-open the page later with `nt-share admin <space>/<hash>`.

## The index page

Every share's root URL is a public page listing what it holds: each uploaded
source, each generated document with every version linked, and each render that
exists. No credential - the unguessable hash is the whole lock. The same URL
with `Accept: application/json` answers the same model as JSON, including the
overflow verdict for any deck render that has one, which is how a program reads
a share rather than scraping the page.

## Conventions

- Space = client or person slug, lowercase (`acme`, `sara`). The space is
  visible in the URL, so pick the name you'd show the recipient.
- Markdown renders as a deck when the content says so - `marp: true` or `---`
  separators - and as a document otherwise. Decks run through Marp, so `---`
  splits slides and Marp directives work: `<!-- _class: lead -->` for the cover,
  `divider` for a section break, `quote` for a pull quote, `split` to run a list
  in two columns, `<!-- paginate: true -->` for slide numbers, and
  `<!-- footer: acme -->` for a running footer. `<p class="eyebrow">01 &middot;
  the model</p>` gets the numbered pink label - write it in sentence case, the
  theme does the capitals. Every slide carries the lockup already, so never
  write a `<style>` block or pick a colour: a hex typed into a deck is a brand
  value nothing can correct later.
- A ```mermaid fence is drawn server-side, in brand colors, on the page and in
  the PDF: flowchart, sequence, state, class, ER, and xychart. Other types
  (pie, gantt, mindmap) show their source instead, so pick one of the six.
  Every other fence comes out highlighted; tag it with its language.
- Full HTTP API: https://share.notambourine.com/llms.txt

## Export formats

Swap the extension on a share URL: uploaded `deck.md`, ask for `deck.pdf`. Two
spellings, and a file uploaded under the suffixed name wins over the export.

| URL | Output |
| --- | --- |
| `deck.md` | branded page, deck or document from the content |
| `deck.pdf` | PDF, deck or document from the content |

`marp: true` front matter or `---` slide separators mean deck, anything else
means document. An uploaded HTML page adds `page.png`, a screenshot of the whole
page at 1280 wide.

A generation's bare name follows its newest version: with `deck.1000.md` and
`deck.2000.md` in a share, `deck.md` and `deck.pdf` serve the 2000 one, and
every older stamp keeps its own URL - which is what makes re-generating safe on
a link already sent.

The deck theme is `deck.css` from the brand kit, the same bytes `nt-brand:system`
hands a local `marp` run, so a deck shared here and one built by hand come out
the same. Upload the markdown; do not render it first.

Attach `deck.pdf` to an email; send `deck.md` when the recipient should click
through the deck. A PDF is rendered by the first request that asks for it, so
that one can take a few seconds; a 202 answer means it is still rendering and
lands on its own. Hand the URL over as `put` printed it - never curl the
suffixes to check they respond.

When a slide clips the page, the index page's JSON says which one. Edit the
source and `put` a fresh deck, or generate again with less material.
