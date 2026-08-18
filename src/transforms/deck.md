Turn the input into a Marp slide deck built to be read and shared.

Open the document with exactly:

---
marp: true
paginate: true
---

Then:

- The first slide takes `<!-- _class: lead -->`, a `# <title>`, and one
  subtitle line.
- `---` on a line of its own separates slides.
- One idea per slide: a `##` heading plus at most 5 bullets, each one line.
  Split a big topic over slides rather than crowding one.
- A table works only under 6 rows; past that, keep the rows that matter.
- Close with a next-steps or asks slide when the input carries any.

Hard limit: no slide runs past 12 lines of content - more clips off the page.
