# Mistakes

## 2026-10-03 — Statistics solve review completeness

- What happened: Statistics hid solve activation in metric buttons, omitted Result comparison and skip details, enabled Tools without raw moves, and left F2L sources and trend points inaccessible.
- Root cause: review presentation was duplicated instead of shared, and tests covered callbacks without checking every solve-bearing surface or review capability.
- Prevention: share analytical presentation with Result, derive source samples in state, and test row/keyboard activation, raw-move capability, full review context, and cross-Session isolation.

## 2026-10-03 — Statistics compatibility and zero-range pairs

- What happened: the first implementation changed the existing aggregate execution split and admitted an unmarked zero-range XCross pair into performance medians.
- Root cause: a shared execution fact was repurposed without preserving its aggregate consumer, and summary skip detection used fewer conditions than XCross detection.
- Prevention: keep existing aggregate formulas explicit when adding measured metrics, and test zero-range pairs independently of their skipped flag.

## 2026-10-02 — Statistics follow-up boundaries

- What happened: Settings could reconcile Timer progress and start hidden
  inspection in Statistics; clicking an active tab cleared review-return state;
  an empty CFOP window was described as an empty scope.
- Root cause: area checks covered move routing but not the Timer workflow methods,
  App cleanup ran before detecting no-op navigation, and chart empty copy lacked
  the distinction between historical scope and the display window.
- Prevention: guard Timer reconciliation and inspection at their owning methods,
  reject same-area navigation before presentation cleanup, and test Settings
  changes while Statistics is open plus scope/window-specific chart messages.

## 2026-10-02 — Statistics review regressions

- What happened: the Statistics filter was mistaken for the active Timer Session,
  CFOP and solve charts used different history windows, SVG classes missed their
  styles, and opening Statistics discarded Training's historical review context.
  Rolling calculations also copied growing prefixes unnecessarily.
- Root cause: the first implementation's tests covered basic derivation but missed
  independent runtime/filter identities, sparse analysis, presentation edge cases,
  and navigation through an intermediate area.
- Prevention: test those boundaries explicitly, use bounded rolling windows,
  match chart windows by counted Solve IDs, and check rendered SVG classes and
  review-return behavior alongside the existing Controller ownership rules.

## 2026-10-02 — OLL/PLL catalogue thumbnail display

- What happened: thumbnails read raw cube-coordinate targets instead of applying
  the physical Training display rotation, so white appeared on top despite the
  white-bottom/yellow-top grip. Side stickers were flattened into a detached
  horizontal strip, and OLL exposed permutation colours rather than orientation.
- Root cause: the thumbnail model omitted the target's display orientation and
  family-specific presentation semantics, leaving the renderer to choose facelets
  and an incorrect layout without focused regression coverage.
- Prevention: the domain model must physically rotate into the display frame, own
  canonical top-down ring ordering, and mask OLL as top-colour versus grey while
  retaining PLL colours. Test display orientation, ring extraction, family colour
  semantics, and attached SVG geometry.

## 2026-10-02 — Ownership refactor patch assembly

- What happened: the first combined patch failed before applying because one
  hunk used `export async function store` while the source declared it without
  `export`.
- Root cause: the patch was assembled from an indexed skeleton rather than the
  exact live declaration.
- Prevention: use the live file text for patch anchors and split multi-file
  changes into smaller verified batches when a declaration is central to the
  edit.

## 2026-10-01 — Advanced F2L thumbnail presentation

- What happened: thumbnail presentation was repeatedly treated as a Basic-vs-
  Advanced styling problem. This first hid too much Advanced context, then exposed
  too much of the cube.
- Root cause: the visual rule was attached to catalogue type instead of the F2L
  teaching semantics.
- Prevention: use one state-derived stickering rule for every F2L case. Colour the
  target corner/edge wherever they are, plus the already-solved cross/F2L foundation
  visible on the target pair's two side colours. Test each non-target F2L corner and
  edge independently: a solved edge remains coloured when its partner corner is
  trapped, and vice versa. Do not collapse the foundation to an all-or-nothing slot
  predicate. Colour only those two side centres. Everything else is grey. Basic and
  Advanced differ naturally because their starting states contain different solved
  F2L structure.

## 2026-10-01 — Advanced F2L published-state authority

- What happened: Advanced states were generated by inverting candidate solution
  algorithms, producing self-consistent but non-authoritative cases.
- Root cause: solution algorithms were treated as state definitions after the
  source-tab model failed. The earlier position-ownership entry's proposed
  prevention was incorrect; independent inverse-derived states are not a remedy.
- Prevention: when an external catalogue publishes an explicit setup/state, that
  state is authoritative. Validate algorithms against it, but never redefine the
  state merely to make validation pass. Source-authority tests must include literal
  published setups, not just inverse-algorithm consistency checks.
- Resolved follow-up: published setups were authoritative, but their intended
  target was incorrectly assumed to be FR. All 54 source states have FR plus one
  other unsolved slot; tab-0 behaviour confirms that other slot as the intended
  target. The ten apparent FR failures did not establish a source/reference mismatch.
  All four tabs validate globally against whole-case rotations with the target
  rotated alongside the state. Derive and store target identity before positioning
  the case for the trainer; do not infer ownership from case numbering.

## 2026-10-01 — Advanced F2L position ownership

This earlier diagnosis and prevention were superseded by the published-state and
target-ownership investigation above. Source tabs describe whole-case rotations,
not independently invented states. The original entry is retained as history.

- What happened: validation failed when Advanced F2L targets were constructed by
  rotating one canonical Front Right setup into every position, including AF2L 3
  Front Left.
- Root cause: the Basic 41-case representation was assumed to cover trapped-piece
  cases, whose source position tabs can describe independent starting states.
- Prevention: generate each Advanced position from its own source-tab solution,
  validate its anchor and references against the unchanged training goal, and test
  all 216 position variants and home-cubie thumbnail masks independently.

## 2026-09-30 — F2L thumbnail target identities

- What happened: F2L case thumbnails highlighted the cubies occupying the target
  slot rather than the cubies whose home positions define the target F2L pair.
  The thumbnail also coloured solved cross/other pairs, hiding the mistake visually.
- Root cause: slot index and cubie identity were treated as interchangeable in an
  unsolved state, and the test repeated the same incorrect lookup.
- Prevention: teaching diagrams identify the F2L pair from the target slot's home
  corner/edge IDs, then locate those IDs in the displayed pattern. Tests assert
  exactly target pair + centres, expected pair colour sets, and no unrelated pieces.

## 2026-09-30

- What happened: the initial scoped check concluded that the required four-slot F2L
  reference dataset was missing.
- Root cause: the first search looked at `f2lCases.ts` but missed the committed
  `algBank.generated.ts` F2L bank that already contains the local 41-by-4 data.
- Prevention: when a specification requires an existing dataset, search the named
  feature files and their directly imported data modules before reporting a blocker.

## 2026-10-03

- What happened: an F2L aggregate TPS regression assertion failed on the final
  floating-point digit despite equivalent durations and move counts.
- Root cause: the test compared division by seconds with division by milliseconds
  followed by multiplication using exact numeric equality.
- Prevention: use approximate assertions for non-integer derived rates; keep exact
  assertions for source counts, boundaries, and integral timings.

- What happened: new last-layer Controller setup tests expected an already matched
  target to avoid invoking the search worker, and failed to reach ready in Node.
- Root cause: `algBetween()` always invokes the search service, even for identical
  patterns; the test assumed an identity fast path that does not exist.
- Prevention: supply a known valid setup at the solver seam in Controller tests,
  then exercise the real setup tracker, move handling, and completion lifecycle.

## 2026-09-29

- What happened: widening `SolveResult.onContinue` to carry a close option briefly made the Back button pass the callback directly as a mouse event handler.
- Root cause: the callback's optional navigation options are not a DOM event shape.
- Prevention: wrap non-event callbacks at JSX event boundaries, especially when their parameter type changes.

## 2026-09-29

- What happened: the new review-return controller test initially injected a virtual F2L move without stubbing `requestAnimationFrame`.
- Root cause: the test started the existing F2L attempt timer but did not reuse the controller suite's timing harness.
- Prevention: stub `requestAnimationFrame` and `cancelAnimationFrame` in every controller test that enters F2L solving.

## 2026-09-29

- What happened: an initial exact solve-step controller assertion expected setup-mode display facelets to equal the target pattern without a connected cube.
- Root cause: setup mode intentionally displays the physical model until the physical cube reaches the target; only virtual mode loads the target into the display.
- Prevention: assert setup-mode target metadata separately, and assert target facelets after explicitly switching to virtual mode.

## 2026-09-29

- What happened: the first controller regression test drove a completing F2L attempt
  without stubbing `requestAnimationFrame`.
- Root cause: the test covered the new setup path but missed the existing attempt-clock
  seam used by controller tests.
- Prevention: reuse the controller test harness's animation-frame stub whenever a test
  injects the first solving move.

## 2026-09-29

- What happened: F2L setup and result notation could expose raw smart-cube faces even
  though the training cube was held in the white-bottom, green-front solver grip.
- Root cause: raw physical/virtual cube coordinates and user-facing F2L notation were
  allowed to share one representation at the controller/UI boundary.
- Prevention: keep trackers and patterns raw, and translate only F2L-facing notation
  through the shared training-grip helper; use that same grip for CubeView input/display.

## 2026-09-29

- What happened: the first 2D training-orientation assertion expected a solver-frame reframe to move white stickers to the displayed bottom face.
- Root cause: `reframe()` changes cube-coordinate interpretation for solving, while the visual net needs a physical whole-cube rotation so sticker colours move with the rendered cube.
- Prevention: distinguish solver-frame transformations from display rotations; use the existing rotation tokens with `KPattern.applyAlg()` for visual facelet output.

## 2026-09-29

- What happened: the first focused Vitest run was attempted inside the Windows sandbox and failed before tests loaded.
- Root cause: Vite's esbuild configuration needs to spawn a child process, which the sandbox rejected with `spawn EPERM`.
- Prevention: follow the Windows verification commands rule in `AGENTS.md` on the first invocation; keeping this known restriction only in the mistake log allowed later agents to repeat it.

## 2026-09-29

- What happened: an initial Header patch did not apply.
- Root cause: the combined hunk depended on exact surrounding JSX/Unicode text that had already shifted.
- Prevention: inspect the current file and apply smaller marker-based hunks for large conditional JSX changes.

## 2026-09-29

- What happened: the next F2L pair used cubing.js `o` to make it darker, causing most stickers on the pair to become grey.
- Root cause: `o` was treated as another brightness level, but it is a mixed facelet stickering mode (`dim` primary + `ignored` non-primary).
- Prevention: when selecting serialized cubing.js stickering characters for visual intensity, verify their per-facelet semantics; use `D` when all original cubie colours must remain visible.

## 2026-09-29

- What happened: a combined presentation patch failed because one later CSS hunk no longer matched after earlier selector edits in the same patch.
- Root cause: the patch bundled dependent selector changes with stale context instead of applying the file-local transformations in smaller hunks.
- Prevention: apply related selector renames and responsive overrides in separate, verifiable patches.

## 2026-09-27

- What happened: the handoff check ran `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` through PowerShell and failed before Git executed.
- Root cause: PowerShell parsed `@{upstream}` as a hashtable expression.
- Prevention: quote Git refspecs that begin with `@` in PowerShell, for example `git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`.
