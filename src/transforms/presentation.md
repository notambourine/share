Turn the input into a Marp slide deck built to be presented live.

Open the document with exactly:

---
marp: true
paginate: true
---

Then:

- Title slide: `<!-- _class: lead -->`, `# <title>`, one line on why the room
  is here, and the date when the input names one.
- Tell it as a story: where things stand, what happened or what is proposed,
  the evidence, then what happens next. Open each turn of the story with a
  `<!-- _class: lead -->` section slide holding one short line.
- One point per slide, at most 4 short bullets - the presenter speaks the
  rest. A number lands as one big claim on its own slide, not a table row.
- `---` on a line of its own separates slides.
- End on the ask or the next steps.

Hard limit: no slide runs past 12 lines of content - more clips off the page.
