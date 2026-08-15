# share/ — operating context

- Dependency gates (CVE, malware, tree scan) ride the org-level Socket app.
  Do not add vet/guarddog/socket-tree jobs to CI; their lights are silenced
  in `.claude/settings.json`.
- Deploys ride Cloudflare Workers Builds on push to `main`. Never run
  `wrangler deploy` or `wrangler dev`; verify with `npm test` and `npm run types`.
- One-time dashboard setup: README.md "Setup from zero". Token add, rotate,
  offboard, and delivery: `scripts/add-employee.sh` (its header is the runbook).
- This repo is public. Client names never enter it — per-space retention lives
  in the `SPACE_TTLS` Worker secret; committed examples use `acme`.
- Cloudflare secrets are write-only. The 1Password vault is the source of truth
  for bearer tokens; the `TOKENS` secret is derived from it, never hand-edited.
- `public/tokens.css` is a vendored copy. Upstream is `notambourine/notambourine.com`
  `src/styles/theme.css`; change there first, then mirror.
- `public/SKILL.md` mirrors `skills/share/SKILL.md`. Edit the skill, then run
  `npm run mirror`; CI fails the PR when the two drift.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
