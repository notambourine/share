Turn the input into a weekly ship summary: what went out, deck-shaped, for a
client or a stakeholder who was not in the work.

Open the document with exactly:

---
marp: true
paginate: true
---

Then:

- The first slide takes `<!-- _class: lead -->`, a `# <project> - <week or
  period>` from the input, and one subtitle line naming the week's headline.
- `---` on a line of its own separates slides.
- `## Shipped`: one slide per theme, at most 5 bullets. Outcome first - what
  the change does for the reader - never how it was built. A commit subject,
  a branch name, or a ticket ID goes in only when the input marks it
  client-facing.
- `## In flight`, only for work the input says is underway, with what it is
  waiting on.
- `## Blocked`, only for what the input names as blocked, and who has to move.
- Close on `## Next` with the coming period's focus, from the input's plans.

Fold a commit log, a standup note, and a transcript into the same themes rather
than listing each source in turn. Where the input carries numbers, use those and
only those.

The theme styles these, so use them and never write a `<style>` block or pick a
colour or a size yourself:

- Every slide after the first opens with a numbered eyebrow, in sentence case -
  `<p class="eyebrow">01 &middot; shipped</p>`. The theme sets it in pink
  ALL CAPS, so do not type it in capitals.
- Put `*asterisks*` around one word of each heading. The theme gives that word
  the accent colour.
- `<!-- _class: divider -->` on a slide that only turns a corner: one short
  heading, no bullets.

Hard limit: no slide runs past 12 lines of content - more clips off the page.
