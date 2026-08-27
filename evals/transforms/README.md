# transforms - live-model evals

Generation sends client-bound content through a real model, so a prompt or
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

    npm run evals
    npm run evals -- deck:            # filter, substring of <transform>:<fixture>

The `evals` script wraps `op run` around the account id and a
`op://Employee/TOM_NTB_WORKERS_API_TOKEN/credential` reference, so it resolves
from 1Password at run time - the token never lands in a file. A "Workers AI"
template token minted for someone else's account needs their own account id
and vault path substituted. The full matrix is 12 calls, well under a cent.

Outputs land in `out/` (gitignored). Read them after any prompt edit: the
checks gate structure and fidelity, not tone. This never joins CI - it spends
inference and carries a token, and the deterministic half of the feature is
already `tests/generate.test.ts`.
