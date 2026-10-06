# Cube domain and frame boundaries

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Physical model/facelets | `src/cube/model.ts`, `facelets.ts` and matching tests |
| Moves/notation | `src/cube/moves.ts`, `notation.ts` |
| Shared move-arrow semantics | `src/cube/moveGuide.ts`; Training checkpoints in `training.ts`, Replay actions in `src/features/history/components/replayTimeline.ts` |
| Physical/held/solver/display frame conversion | `src/cube/frames.ts`, `orientation.ts`, `recognise.ts` |
| Grip facts/reconstruction | `src/cube/gyroGrip.ts`, `liveGrip.ts`, `gripTrack.ts` |
| CFOP analysis/case recognition | `src/cube/analysis.ts`, `recognise.ts`, the relevant family module |
| Scramble tracking/generation | `src/cube/scramble.ts`; runtime integration in [RUNTIME.md](RUNTIME.md) |

Read [TRAINING.md](TRAINING.md) for target lifecycle/semantics, [RUNTIME.md](RUNTIME.md) for device ownership, or [PERSISTENCE.md](PERSISTENCE.md) for stored Solve facts.

## Cube/domain boundary

`src/cube/` contains cube/domain behavior and must remain independent of:

- React presentation;
- Bluetooth transport;
- persisted application records in `src/app/types.ts`.

Important responsibilities include:

- `model.ts` — cube state;
- `facelets.ts` — facelet/KPattern conversion;
- `scramble.ts` — event definitions, scramble generation and scramble progress;
- `notation.ts` — move representation, timestamps and turn metrics;
- `moveGuide.ts` — generic move-visualization semantics shared by Training and Replay;
- `orientation.ts`, `gyroGrip.ts`, `liveGrip.ts`, `gripTrack.ts` — orientation and held-frame behavior;
- `analysis.ts` — CFOP phase detection and solve metrics;
- `recognise.ts` and related modules — case recognition;
- cross modules — cross solving, planning and targeted scramble generation;
- F2L modules — case authority, recognition, training targets and training metrics;
- solver modules — state-to-state search and solution support.

Do not turn `src/cube` into a persistence layer or UI layer merely because those layers consume cube-domain behavior.

## CubeModel ownership

`src/cube/model.ts` represents the cube state the normal application currently believes to physically exist.

Smart-cube moves update it.

Normal virtual/keyboard cube moves use the same move-processing path.

A complete facelet state received from hardware may replace the pattern to resynchronize the application with the physical cube.

The physical/normal `CubeModel` has a different meaning from any virtual Training target.

They must remain distinct.

## Solve model

A `Solve` belongs to exactly one Session through `sessionId`.

Raw timing and penalty are separate.

A smart-cube Solve can retain:

- scramble;
- timed move stream;
- starting facelets;
- optional `solveStartBottomFace`, the independently observed physical bottom face at solve start;
- encoded grip information;
- derived `SolveAnalysis`;
- optional interchange/import metadata.

The Session supplies the event context; the Solve does not carry a duplicate `EventId`.

### Derived analysis

Raw solve facts are authoritative.

`SolveAnalysis` is derived and rebuildable.

When stored analysis uses an obsolete/unreadable shape, loading may rebuild it from retained scramble/move facts and persist the repaired record.

Analyses are versioned by `ANALYSIS_VERSION` in `analysis.ts` (a missing
`analysisVersion` reads as 1). An analysis older than the current version is
rebuilt the same way when the solve still has its moves and a starting state;
when it cannot be rebuilt, such as a CSV import without moves, it is kept as it
is. Raise the version whenever the analysis starts recording something new.

`solveHistory.ts` owns Session and Statistics history loading and persistence of
successful repairs. `repair.ts` derives the repaired Solve using cube-domain
analysis; raw scramble/move facts remain authoritative. Current analysis with quality
is left untouched, and successful repairs are persisted once. Missing quality also
triggers repair when raw facts remain available.

Version 3 carries derived CFOP quality: `trusted` or `suspect` with machine-readable
issues. `isTrustedCfopAnalysis` is the shared boundary for current, explicitly trusted
CFOP analysis. Legacy analysis without quality remains readable but is untrusted.
Suspect analysis stays inspectable in History, Result and Replay; it is excluded from
CFOP metrics, comparisons, case statistics, training suggestions and step-specific
Training/Analysis tools. Ordinary timing, averages and PB eligibility are independent.

`analysis.ts` is the sole CFOP interpreter. Candidate checkpoints accumulate invariants:
Cross edges solved; each F2L milestone also has Cross plus the required solved pairs;
OLL completion also retains full F2L and a uniform opposite face; PLL ends at solution.
Shared XCross checkpoints are valid. Missing slot assignment or non-skipped last-layer
recognition adds a quality issue; a null F2L catalogue case alone does not.
Without independent evidence, a unique pre-solution full-F2L candidate establishes the
Cross; multiple candidates or only final-state F2L are ambiguous. Meaningful progression
on the observed bottom resolves ambiguity; disagreement with meaningful state-derived
progression is suspect.

Timer captures `solveStartBottomFace` before `holdBottom`. It supplies that observation
to grip reconstruction and analysis when available; otherwise grip uses its gyroscope
fallback. Only trusted preliminary boundaries may anchor drift correction. Old grip
tracks must not be promoted to independent observations: they used inferred Cross priors.
An analysis conclusion must never become the evidence validating that same conclusion.
Rejected: using `Settings.crossColour` as ground truth (it is preference, not a per-solve
fact), or feeding inferred `analysis.crossFace` back as independent truth (circular validation).

Native CFOP analysis consists of:

1. Cross
2. F2L Slot 1
3. F2L Slot 2
4. F2L Slot 3
5. F2L Slot 4
6. OLL
7. PLL

Per-step analysis includes information such as:

- moves;
- timing;
- recognition/execution split;
- cumulative timing;
- turn metrics;
- TPS;
- case: the OLL number, the PLL name, or for an F2L pair the catalogue case
  (`"F2L n"`) it started as, recognised with `recognizeF2lSlot` (null when the
  pair was already solved or buried);
- F2L slot (in the scrambled cube's own frame);
- F2L insertion position (`insertedAt`, since analysis version 3): where the pair
  went in relative to the solver's hands, after any rotations. It is read from the
  grip track when one was recorded; otherwise it is inferred from the step's turns
  (the slot face turned most, or on a tie last, is the solver's R or L, so the pair
  is a front-right or front-left insert) and marked `insertedAtSource: "inferred"`;
- move-stream boundaries.

Solver-facing F2L statistics group pairs by insertion position, not by cube slot.
Rejected: grouping by the cube-frame slot mapped through the starting grip. Every
solve fills every cube slot once, so those groups only count solves and say nothing
about technique.

Detailed algorithm rules belong in the relevant `src/cube` modules and tests rather than in this architecture document.

## Orientation and grip

Smart cubes report turns relative to their fixed centers. Physical cube rotations are not themselves reported as ordinary face turns.

Grip/orientation logic therefore tracks how the cube was held and can translate cube-frame moves into the frame used by the solver.

This supports presentation and analysis of:

- move notation;
- cross colour;
- F2L slots;
- replay orientation;
- OLL/PLL state;

in a frame meaningful to the solver rather than only the cube's fixed internal frame.

## Explicit frame operations

`src/cube/frames.ts` is the shared conversion entry point. It owns move/algorithm
conversion and display rotation, and exposes the existing case-reframing helpers
from `recognise.ts`. `orientation.ts` owns `Orientation`, `Rotation`, grip choices
and orientation composition. Training targets retain their explicit
`trainingRotation`; no additional frame representation competes with it.

| Boundary | Operation and meaning |
| --- | --- |
| Physical facts | PhysicalCubeRuntime's CubeModel, reported turns and persisted raw moves use the fixed physical cube frame |
| Physical -> held/Training notation | `handMove` for one move; `handAlgorithm` for a complete algorithm; `handTimedMoves` preserves timestamps |
| Held/Training -> physical notation | `cubeMove` for one move; `cubeAlgorithm` for a complete algorithm |
| Solver/case frame | `reframe` conjugates the transformation, relabelling pieces and slots together; `withCentresHome` removes residual whole-cube rotations |
| Display frame | `orientFaceletsForDisplay` physically rotates the viewed pattern, including centres, without changing physical state |

Single-move helpers reject whitespace-containing algorithm strings and direct the
caller to the corresponding algorithm helper. Algorithm helpers expand notation
before converting each move. Runtime recovery always converts an entire algorithm.
Display rotation is a presentation projection; it must never replace the physical
CubeModel or substitute for case recognition's `reframe` operation.

## Shared move visualization

Generic move-visualization semantics — token kind, axis, layer interval, direction,
and half-turn representation — are cube-domain behavior shared by Training and
Replay. `moveGuideForToken` interprets one supported visible token, optionally
through an explicit orientation. Training owns reference checkpoints and
confirmation progress, including the actual centre orientation at each checkpoint.
Replay owns recorded physical turns, inserted grip rotations and timestamps;
its already-rewritten visible actions must not have the solve grip applied again.
React only presents these facts: `CubeMoveGuide` draws them and `MoveSequence`
presents controlled tokens without owning either timeline.

## Rejected alternatives

### A universal Training/Replay timeline

Do not merge `TrainingGuide` and `ReplayAction` into one universal timeline
abstraction. Their expected reference checkpoints/confirmation and recorded
turns/rotations/timestamps have different meanings. Combining them would obscure
those semantics and create a broad abstraction without a shared source of truth.

### Interpret move arrows again inside Replay presentation

Rejected because a second notation/frame implementation would allow Training and
Replay arrows to drift. Both use the cube-domain move guide and shared SVG renderer.

### Treat display rotation and case reframing as the same operation

Physically rotating a pattern preserves piece identities while moving their slots.
Case reframing relabels both. Substituting one for the other can display correct
colours while producing incorrect slot/case recognition. Keep explicit operations
with separate regression coverage.

### Transform a complete algorithm with a single-move helper

`handMove`/`cubeMove` describe one move. A complete string could previously pass
through untransformed. The single-move boundary now rejects such input; use
`handAlgorithm`/`cubeAlgorithm` to transform every expanded move instead.

### Moving persisted Solve into the cube domain

Rejected:

```text
Move or import the complete persisted Solve record into src/cube so F2L
Training can reconstruct a historical case.
```

Reason:

```text
The persisted Solve contains session, persistence, and interchange concerns
that do not belong to the pure cube domain.
```

`F2lTrainingSolveInput` is the narrow domain-facing seam instead.


## Training source and executable references

`sourceAlg` is stable algorithm notation in catalogue/personal case semantics.
`alg` is the executable reference aligned to one concrete Training target, including
AUF and final AUF where necessary. Canonical references retain both without changing
ranks. F2L and last-layer domain resolvers share canonical alignment/completion rules
and return only source/executable algorithm and STM. Last-layer personal resolution
searches the natural alignment first, remaining U alignments next, and prefers a
valid solution without unnecessary final AUF. Stage-specific 2-Look goals remain authoritative.

Personal algorithms reuse `buildTrainingGuide`, strict checkpoint/reference matching,
rotation/wide/slice handling and `calculateTrainingEfficiency`. Canonical and preferred
matches remain independent; canonical comparison facts retain their meaning.
Cube domain validates/resolves algorithms and never owns persistence keys, notes,
timestamps or a user preference Store. Persisting target-adjusted algorithms,
replacing canonical rank 1, and creating another matcher are rejected because stable
source semantics and distinct benchmark facts already fit the existing reference engine.

## Smart catalogue target variations

KPattern + Alg and the existing cube modules remain the single pure state authority;
CubeModel is the mutable physical/normal wrapper. Runtime chooses variation, while
F2L/last-layer target builders construct, recognize, align references and validate
completion. F2L positions authoritative setup in the held Training frame, applies
TrainingAuf U there, then transforms back through the existing frame seam. Shared
quarter-turn AUF values/tokens belong to cube/training.ts; LastLayerAuf aliases them.
Last-layer variant/AUF authority remains in lastLayerTraining.ts. Exact historical
state/grip/boundaries never randomize.

Generated concrete state does not split durable catalogue identity. Canonical and
personal sourceAlg remain stable; executable alg changes to solve the actual state.
My Algorithm save/import validation covers every concrete AUF/variant the generator
may emit, using the family builders/resolvers, not another cube validator. Physical
F2L direct setup is accepted only when its full AUF-inclusive tracker reaches the exact
target; wide/slice setup continues through generic solver fallback.

### Rejected: a second generic Training cube-state engine above KPattern

The current cube domain already owns state, frames, recognition, target construction,
completion, source/executable references and checkpoints. A parallel engine would
introduce competing authority. Feature policy chooses variation; it does not interpret
cube state.
