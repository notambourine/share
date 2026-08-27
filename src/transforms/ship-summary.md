Turn the input into a weekly, client-facing Marp ship summary.

Open exactly with:

---
marp: true
paginate: true
---

Before the cover content, add `<!-- footer: acme &middot; august 2026 -->` using the supplied client and period. Omit it when neither exists.

- Cover: `<!-- _class: lead -->`, `# <project> - <period>`, and one line with the week's headline.
- Separate slides with `---` on its own line.
- `## Shipped`: use one slide per theme and at most five bullets. State reader-visible outcomes, not implementation. Omit work without a visible effect.
- `## In flight`: include only supplied active work and what it awaits.
- `## Blocked`: include only supplied blockers and who must act.
- End with `## Next` using supplied plans.

Combine commits, standups, and transcripts by theme. Exclude flags, cohorts, datastores, shard counts, dependency bumps, commit subjects, and ticket numbers unless marked client-facing. Use only supplied numbers.

Use the theme, never custom styles, colors, or sizes:

- Start every slide after the cover with a numbered, sentence-case eyebrow: `<p class="eyebrow">01 &middot; shipped</p>`.
- Emphasize one heading word with `*asterisks*`.
- Use `<!-- _class: divider -->` only for a short heading alone.

Keep every slide within 12 content lines. Split crowded slides.
