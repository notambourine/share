# share/: operating context

- Dependency gates (CVE, malware, tree scan) ride the org-level Socket app.
  Do not add vet/guarddog/socket-tree jobs to CI; their lights are silenced
  in `.claude/settings.json`.
- Deploys ride Cloudflare Workers Builds on push to `main`. Never run
  `wrangler deploy` or `wrangler dev`; verify with `npm run lint`, `npm test`,
  and `npm run types`. CI runs the same three.
- One-time dashboard setup: README.md "Setup from zero". Token add, rotate,
  offboard, and delivery: `scripts/add-employee.sh` (its header is the runbook).
- This repo is public. Client names never enter it; per-space retention lives
  in the `SPACE_TTLS` Worker secret; committed examples use `acme`.
- Cloudflare secrets are write-only. The 1Password vault is the source of truth
  for bearer tokens; the `TOKENS` secret is derived from it, never hand-edited.
- `public/tokens.css` is a vendored copy. Upstream is `notambourine/notambourine.com`
  `src/styles/theme.css`; change there first, then mirror.
- `skills/share/SKILL.md` is the only copy of the skill. `src/skill.ts` imports
  it to serve `/SKILL.md`; never add a copy under `public/`.
- `skills/` is the published plugin surface, and this repo holds no other
  skills. Never vendor a third-party skill tree here; that machinery lives in
  its own repo.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
