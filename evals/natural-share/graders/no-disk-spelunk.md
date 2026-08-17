---
type: regex
pattern: '"(command|file_path)"\s*:\s*"[^"]*plugins/cache/[^"]*nt-share[^"]*SKILL\.md'
match: "not_contains"
target: "trace"
---
<!-- Tool-input forms only: a legit Skill invocation puts the cache path in
     the trace (the load header and the doc's own install one-liner), so a
     bare path match false-positives on the passing case. -->

The agent did not read SKILL.md off the plugin cache path instead of invoking the skill.
