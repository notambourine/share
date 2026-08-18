# transforms - live-model evals

`?transform=` sends client-bound content through a real model, so a prompt or
model edit needs evidence, not vibes. This suite runs every prompt in
`src/transforms/` against every fixture here, on the live model over the REST
API, through the same `runPrompt` the Worker calls - what passes here is what
ships. `checks.mjs` grades deterministically:

- structure: a deck opens `marp: true` and no slide overruns; a document has a
  title and sections; no preamble, fence wrap, or thinking block.
- retention: the `fixtures/must-keep.json` facts survive the rewrite.
- fabrication: every URL and dollar amount in the output exists in the input,
  and the instruction injected into `meeting-notes.md` stays inert.

Run it by hand:

    CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token> npm run eval:transforms
    npm run eval:transforms -- deck:            # filter, substring of <transform>:<fixture>

The token wants the dashboard's "Workers AI" template; the account id sits on
the dashboard's Workers overview. Pass both per run (or via `op run`) - never
into a file. The full matrix is 15 calls, well under a cent.

Outputs land in `out/` (gitignored). Read them after any prompt edit: the
checks gate structure and fidelity, not tone. This never joins CI - it spends
inference and carries a token, and the deterministic half of the feature is
already `tests/transform.test.ts`.
