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
- The brand's golden set is the `upstream/nt-brand` submodule. `src/brand.ts`
  imports `tokens.css` and `deck.css` from it and the Worker serves them at
  `/tokens.css` and `/vendor/marp/nt-marp.css`. Never add a copy under
  `public/`; correct a brand value in that repo and bump the pin.
- `public/fonts/*` is the one brand copy, because a static server should serve
  a woff2. `npm run vendor` refreshes it.
- Every color in this repo must be one the golden set defines, including inside
  a `var()` fallback, and every `var(--x)` must read a token it still declares.
  `npm run brand` is the gate and CI runs it.
- `skills/share/SKILL.md` is the only copy of the skill. `src/skill.ts` imports
  it to serve `/SKILL.md`; never add a copy under `public/`.
- `skills/` is the published plugin surface, and this repo holds no other
  skills. Never vendor a third-party skill tree here; that machinery lives in
  its own repo.
- Never generate or echo a raw bearer token in a session; that is terminal-only
  work via `scripts/add-employee.sh`.
