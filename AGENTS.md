# Repository instructions

This file is the canonical working agreement for every agent in this
repository, whichever tool loads it. Codex loads it directly; Claude Code
reaches it through `CLAUDE.md`, which does nothing but point here. Keep it
tool-neutral, and keep each rule in exactly one place.

Follow the applicable nested `AGENTS.md` before modifying a feature.

## Architecture context

`docs/architecture/` is the authoritative description of the system as it
exists now. Start at `docs/architecture/SYSTEM.md`: its **Agent loading**
section routes each kind of task to the smallest relevant document, and every
architecture document repeats that routing for its own area. The routing table
is deliberately not copied here — one copy cannot drift.

Load only what the task needs and stop once the change can be made safely. Do
not scan sibling features unless the task crosses a feature boundary.

Record mistakes in `MISTAKES.md`: what happened, the root cause, and the
prevention.



### Quick fixes

When the user explicitly asks for a **quick fix**, **small fix**, or similarly
minimal handling, keep the implementation and verification process proportional
if the change is confirmed to be narrow and low risk.

A quick fix is appropriate for a localized change with no meaningful impact on
architecture, persistence, shared contracts, public boundaries, or
cross-feature behavior.

For a confirmed quick fix:

- make the smallest safe change and avoid unrelated refactoring, cleanup, or
  abstraction work;
- investigate only enough to establish the cause, affected code, and exact edit
  safely;
- use code inspection and the narrowest useful existing test when appropriate;
- do not add tests solely for a trivial change unless they protect meaningful
  behavior or a demonstrated regression;
- do not automatically widen verification to feature suites, full repository
  tests, typecheck, lint, production build, browser/manual verification, or
  additional review agents;
- do not turn a few-line low-risk fix into a broader validation or refactoring
  exercise without a concrete reason.

A quick-fix request reduces process breadth, not correctness. If investigation
shows that the change has broader risk or crosses an architectural or shared
contract boundary, use the normal risk-proportionate verification policy
instead and explain why the quick-fix path was not sufficient.


## Repository workflow


### Implementation delivery

For a completed implementation or change task, verification is followed by
the repository handoff by default:

- commit all in-scope changes on the current branch;
- push the current branch to its configured upstream;
- run state-changing Git commands (`git add`, `git commit`, and `git push`)
  directly in the host/escalated context; do not first attempt them in the
  sandbox, where the repository's Git metadata is read-only;
- report the commit SHA, push result, and any residual verification failure.

Do not stop at an uncommitted worktree or local-only commit, and do not ask
whether to commit or push unless the user explicitly opts out or the required
Git operation encounters an actual authentication or authorization failure.

### RepoWise hooks (Codex-specific)

`.codex/hooks.json` is the active lean RepoWise configuration. The previous
full-refresh configuration is saved in `.codex/hooks.repowise-full.json`.
Restore full behavior by replacing `hooks.json` with the contents of
`hooks.repowise-full.json`. The RepoWise MCP configuration remains enabled.

### Unrelated failures

Do not investigate or fix unrelated failures, warnings, formatting issues, or
other feature problems merely because verification finds them. If a failure is
demonstrably unrelated, report it briefly, leave it unchanged, and continue
the requested scope when possible. Do not call something "pre-existing"
unless that can actually be established. A feature-local task must not become
sibling-feature discovery or refactoring just because broader verification
found an unrelated issue.


### Discovery and documentation

- Do not load large generated, static, or data files merely for discovery.
- Prefer controllers, adapters, stores, components, and relevant tests as
  discovery anchors.
- Do not scan sibling features for examples unless the task crosses feature
  boundaries.
- Stop discovery once enough context exists to implement the requested change.

Implementation does not automatically require architecture documentation:

- implementation conforms to existing architecture -> code only;
- documented current-state architecture becomes incorrect -> update the
  current architecture documentation;
- a durable architectural choice is made -> record the rule and its rejected
  alternative in the affected architecture document, in the same change.

Do not update architecture docs merely because implementation details moved,
were renamed, or presentation changed when the documented architecture
remains true.

