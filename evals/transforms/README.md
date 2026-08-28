# transforms - live-model evals

Generation sends client-bound content through a real model, so a prompt or
model edit needs evidence, not vibes. `fixtures/cases.json` names every case -
a transform, the sources it composes, and what that pairing owes - and each
runs on the live model over the REST API, through the same `runPrompt` the
Worker calls. What passes here is what ships.

Cases are named pairings, not a cross product. A renewal summary built from
scratch notes for a Thursday call is a document nobody asks for, and grading
one taught nothing; each case carries a `why` saying what it is for. Two of
them are the reason the feature exists: `ship-summary:github-week` composes a
commit log, a PR dump, and a week of standup notes into one deck, and
`ship-summary:github-quarter` asks for the same thing over ten times the input.

`checks.mjs` grades in three tiers:

- hard gates, every case: the answer is a bare document with no preamble, fence,
  or thinking block; every URL and dollar amount in it exists in the input; an
  instruction pasted into a source stayed inert; and `renderSource` - the same
  entry point a `.md` GET uses - turns it into the mode the format owes. A deck
  whose front matter the model fumbled fails here and nowhere else.
- format gates: a deck opens `marp: true`, holds one `lead` cover, and no slide
  runs past 12 content lines; a document has a title and a section. `agenda.md`
  makes its later sections conditional, so one section is the floor.
- per-case: the `keep` facts survive, the `forbid` strings do not, and for the
  two client-facing formats no commit subject or short sha reaches the reader.

Voice is measured and printed, never gated. The suite used to fail a case whose
verbatim-phrase score fell under a floor, and the floor was rejecting correct
answers: `ship-summary.md` orders outcome-first prose over commit subjects, so
the best deck in the matrix scored lowest. Recall and precision both rank the
matrix by how prose-like the source was rather than by fidelity, so no honest
threshold exists. Read the number as drift across a prompt edit, and read `out/`
for tone.

Run it by hand:

    npm run evals
    npm run evals -- ship-summary:      # filter, substring of <transform>:<case>

The `evals` script wraps `op run` around the account id and a
`op://Employee/TOM_NTB_WORKERS_API_TOKEN/credential` reference, so it resolves
from 1Password at run time - the token never lands in a file. A "Workers AI"
template token minted for someone else's account needs their own account id
and vault path substituted. Nine cases, well under a cent.

Outputs land in `out/` as `<transform>--<case>.md`, and every request and answer
in `out/calls.jsonl` (both gitignored). The console prints verdicts only; read
the files for the documents. This never joins CI - it spends inference and
carries a token, and the deterministic half of the feature is already
`tests/generate.test.ts`.

`node-hooks.mjs` is what lets the render gate call the Worker's own renderer:
`src/render/markdown.ts` reaches stylesheets imported as text and writes
relative imports without extensions, and node does neither. It is the same job
`vitest.config.ts` does with Vite plugins.
