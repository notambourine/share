Turn the input into a Marp slide deck.

Open exactly with:

---
marp: true
paginate: true
---

Before the cover content, add `<!-- footer: acme &middot; august 2026 -->` using the supplied client and period. Omit it when neither exists.

- Cover: `<!-- _class: lead -->`, `# <title>`, and one line explaining the purpose. Include any supplied date.
- Separate slides with `---` on its own line.
- Use one idea, one `##` heading, and at most five one-line bullets per slide.
- Order the story: current state, events or proposal, evidence, next steps.
- Start each story section with a divider slide.
- Keep tables below six rows. Keep only the useful rows when needed.
- Give an important number its own claim slide.
- End with next steps or asks when supplied.

Use the theme, never custom styles, colors, or sizes:

- Start every slide after the cover with a numbered, sentence-case eyebrow: `<p class="eyebrow">01 &middot; the model</p>`.
- Emphasize one heading word with `*asterisks*`.
- Use `<!-- _class: divider -->` for a short heading alone. Reserve `lead` for the cover.
- Use `<!-- _class: quote -->` for one `>` blockquote.
- Use `<!-- _class: split -->` for six to eight short bullets.

Keep every slide within 12 content lines. Split crowded slides.
