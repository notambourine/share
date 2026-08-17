# evals - skill-invocation suite

Runs with `claude plugin eval .` (early access; inert until that flag reaches
this org). Two cases from the 2026-08-16 QA triage: a natural share ask and
the QA run's "test the skill" framing, each graded on invoking
`Skill(nt-share:share)` and on not reading `SKILL.md` off the plugin cache
path. `allowed_tools: []` on every case, so an eval agent can never upload or
raise a 1Password prompt; the invoke-or-not decision it grades happens first.
