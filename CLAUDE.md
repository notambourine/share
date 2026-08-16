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
- Never hand-edit `public/tokens.css`, `public/vendor/marp/nt-marp.css`, or
  `public/fonts/*`. They are copies of the nt-brand golden set, pinned at
  `upstream/nt-brand`. Correct the value in that repo, bump the submodule,
  then `npm run vendor:brand`. `npm run brand` is the gate and CI runs it.
- Every color in this repo must be one `public/tokens.css` defines, including
  inside a `var()` fallback. `npm run brand` fails on any other.
- `skills/share/SKILL.md` is the only copy of the skill. `src/skill.ts` imports
  it to serve `/SKILL.md`; never add a copy under `public/`.
- `skills/` is the published plugin surface, and this repo holds no other
  skills. Never vendor a third-party skill tree here; that machinery lives in
  its own repo.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
