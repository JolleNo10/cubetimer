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
- `stepExecution.ts` — what was executed within a step: the catalogue algorithm a
  step ended with, and the looks of a last-layer step;
- `physicalTurns.ts` — an algorithm as the face turns a smart cube reports;
- `alternatives.ts` — what a solve could have been: shorter routes to each step's
  result, other pairs and the best pair order with catalogue algorithms, XCross, and
  one-look last-layer algorithms, each playable as cube-frame turns;
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

Version 3 introduced derived CFOP quality; merged version 6 preserves pair identities,
compares full candidate progression and retains independent physical evidence, alongside
version 5 execution recognition and shared-boundary provenance:
`trusted` or `suspect` with machine-readable issues. Automatic quality is derived and
rebuildable. `isTrustedCfopAnalysis` answers only machine trust; application-level
`isUsableCfopAnalysis(solve)` additionally rejects the durable user veto
`Solve.cfopAnalysisExcluded`. Legacy analysis without quality remains readable but
untrusted. Excluded breakdowns stay inspectable in History, Result and Replay, but cannot
enter CFOP metrics, comparisons, case statistics, training suggestions or step-specific
Training and alternatives in Review. Ordinary timing, averages and PB eligibility are independent.

`analysis.ts` is the sole CFOP interpreter. Candidate checkpoints accumulate invariants:
Cross edges solved; each F2L milestone requires Cross, every previously assigned slot
solved/restored, and another solved slot. Pair identities accumulate, not merely pair
counts. Temporary disruption is allowed between milestones. OLL completion retains full
F2L and a uniform opposite face; PLL ends at solution. Shared XCross/XXCross and simultaneous
pair checkpoints are valid. Missing slot assignment or non-skipped last-layer recognition
adds a quality issue; a null F2L catalogue case alone does not.

Candidate coherence includes concrete slots and OLL/PLL recognition in the candidate frame.
Deterministic Pareto dominance compares the complete canonical vector: Cross, F2L1, F2L2,
F2L3, F2L4, OLL and solution, plus unassigned slots, unrecognized last-layer states and
collapsed-progression evidence and raw state counts supporting each accumulated Cross/pair
invariant. Support is measured independently for each milestone, with no weighted score or
percentage cutoff. An initially complete F2L is direct evidence for a last-layer-only solve.
A stronger candidate must be no worse in every dimension
and better in at least one. An isolated early checkpoint cannot compensate for worse
later progression. Late accidental full-F2L states do not alone create ambiguity;
interpretations trading off different strengths remain competing. Sustained Cross/pair support
orders their inspectable best-effort breakdown without authorizing a competing interpretation.
Local shared checkpoints,
prepared pairs and LL skips remain legitimate. A globally collapsed interpretation without
supporting prepared pairs is suspect; identity-preserving milestones, full-vector comparison
and physical conflicts provide further structural safeguards. There are no maximum move/time
limits or penalties for inefficient turning, transient disruptions or rotations.

Timer captures `solveStartBottomFace` before `holdBottom`; it remains the strongest exact
physical observation. `trackGrip.bottomFace` is the reconstruction constraint, which may
use that prior. Separately, `trackGrip.gyroBottomFace` always computes the whole-solve
bottom vote from raw readings/reference, even when a start prior exists. No usable readings
or a tied top vote produce no independent gyro evidence; internal reconstruction fallbacks
must not masquerade as measurements. Final analysis receives both available sources through
`CfopAnalysisEvidence`, without persisting the gyro vote as `solveStartBottomFace`.

Agreeing physical sources can resolve competing state interpretations. A single source
can do so too, but conflict with a stronger state candidate is suspect. Disagreeing start
and gyro observations produce `bottom-evidence-conflict`; neither may then settle state
ambiguity. State progression selects the best inspectable breakdown, always suspect in
that conflict. Only trusted preliminary boundaries may anchor grip drift correction, and
an unaided CFOP Cross is never supplied as the grip prior. Old persisted grip tracks are
not independent historical evidence because they may have used an inferred Cross prior.
An analysis conclusion must never become evidence validating itself.

Rejected: using `Settings.crossColour` as ground truth (preference, not a per-solve fact),
or inferred `analysis.crossFace` as independent truth (circular validation). Also rejected:
treating every face that reaches pre-solution full F2L as equally plausible. Late accidental
cube states create false ambiguity and do not represent equivalent CFOP explanations.
Also rejected: collapsing support into a weighted score with a percentage cutoff for
competitors. Trade-offs must remain explicit; a numeric lead cannot silently authorize
an interpretation whose complete progression is incomparable.
Rejected as well: choosing the face whose F2L completes first, and dismissing a face as
accidental because another oriented its last layer before it finished F2L. One turn
before the end of any solve, the face opposite the last turn shows a finished F2L under
a uniform face. The first rule read a Jb with an AUF as OLL 5 on another face, and the
second handed every full last-layer skip to the wrong face. A 2026 audit of every bank
OLL/PLL algorithm on all six cross colours found the earlier rules naming a wrong case
or marking a clean solve suspect for over a third of them.

History quality badges are limited to counted SmartCube solves, using ordinary eligibility;
Slow Solve and Replay/practice rows keep their existing badges. Detailed warnings remain
available on those solves. Replay always prefers a recorded grip track; absent one, only
usable CFOP (machine-trusted and not manually excluded) may supply the Cross-frame fallback.
Unusable analyses replay raw cube-frame
moves, without silently relabelling them by the suspect Cross.

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
- case: the OLL number or PLL name of the state the step began from, or for an F2L
  pair the catalogue case (`"F2L n"`, or `"AF2L n"` for a pair stuck in a slot) it
  was solved from (null when the pair was already solved);
- `executedAlg`, `caseAt`, `setupMoves` (since version 5): the catalogue algorithm
  the step ended with, where its case was read, and the turns spent before it;
- `looks` (since version 5): an OLL or PLL step split into the looks it was done
  in — one for a one-look step, two for 2-look OLL or PLL;
- `solvedDuring` (since version 5): a pair that went in with the cross (xcross) or
  with the pair before it. It has no moves but is not a skip;
- F2L slot (in the scrambled cube's own frame);
- F2L insertion position (`insertedAt`, since analysis version 3): where the pair
  went in relative to the solver's hands, after any rotations. It is read from the
  grip track when one was recorded; otherwise it is inferred from the step's turns
  (the slot face turned most, or on a tie last, is the solver's R or L, so the pair
  is a front-right or front-left insert) and marked `insertedAtSource: "inferred"`;
- move-stream boundaries.

Once the face is chosen, milestones are dated by when they were first reached: the
cross by the first state with its edges in, and pair k by the first state after the
previous one with the cross in and at least k pairs. Recognition runs to the first
turn that is not a U.
Rejected: dating each milestone by when it stays in place for good, and running a pair
step on to the end of a catalogue algorithm that drops the pair in early (`R' F R F'`).
Over 2,995 recorded solves, step boundaries agreed with the exporting timer's own
analysis 99.7% of the time under first-reached dating and 44% under stable dating.
Turning the bottom layer while working on pairs keeps the cross out for many moves
without undoing it.

F2L cases are the case the pair stood as when its step began, basic or advanced
(`AF2L n`, for a piece stuck in a slot). Only a pair that began as neither is read
where the catalogue algorithm that finished it started. Each step is also matched
from its end against the algorithm bank, held in any `y` (`executedAlg`); the turns
before the match are `setupMoves`. Last-layer steps are split into looks wherever the
first two layers are intact and either a catalogue algorithm has just finished or the
solver paused, and each look has its own case, two-look name and recognition time.
Rejected: reading the F2L case where the matched algorithm starts. Almost every
insertion ends in a catalogue trigger, so that reads most pairs as the trivial
paired-up cases rather than the case the solver faced.

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
