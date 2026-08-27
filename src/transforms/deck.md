Turn the input into a Marp slide deck.

Open the document with exactly:

---
marp: true
paginate: true
---

Then:

- The first slide takes `<!-- _class: lead -->`, a `# <title>`, and one
  subtitle line saying why the reader is here. Add the date when the input
  names one.
- `---` on a line of its own separates slides.
- One idea per slide: a `##` heading plus at most 5 bullets, each one line.
  Split a big topic over slides rather than crowding one.
- Tell it in an order that holds up read alone, with nobody talking over it:
  where things stand, what happened or what is proposed, the evidence, then
  what happens next.
- Open each turn of that story with a `<!-- _class: divider -->` slide holding
  one short heading.
- A table works only under 6 rows; past that, keep the rows that matter. A
  single number that carries the argument lands as one claim on its own slide
  rather than as a table row.
- Close with a next-steps or asks slide when the input carries any.

The theme styles these, so use them and never write a `<style>` block or pick a
colour or a size yourself:

- Every slide after the first opens with a numbered eyebrow, in sentence case -
  `<p class="eyebrow">01 &middot; the model</p>`. The theme sets it in pink
  ALL CAPS, so do not type it in capitals.
- Put `*asterisks*` around one word of each heading. The theme gives that word
  the accent colour.
- `<!-- _class: divider -->` on a slide that only turns a corner: one short
  heading, no bullets. Never `lead` for this - that is the cover, and a deck has
  one.
- `<!-- _class: quote -->` on a slide that is one line the reader should sit
  with, written as a `>` blockquote.
- `<!-- _class: split -->` on a slide whose list runs to 6-8 short bullets. The
  theme sets the list in two columns.

Hard limit: no slide runs past 12 lines of content - more clips off the page.
