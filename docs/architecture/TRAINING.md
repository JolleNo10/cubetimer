# Training runtime and family semantics

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Training lifecycle, setup, virtual pattern, attempts, recovery, retry | `src/features/training/TrainingRuntime.ts` and its tests |
| Single/Drill activities, selected pools and countdown | `src/features/training/TrainingRuntime.ts`, `trainingDrill.ts`, `components/TrainingDrill.tsx` |
| Completed Training history, catalogue performance and Random/Review | `src/features/training/trainingHistory.ts`, `trainingPerformance.ts`; composition in `src/app/Controller.ts` |
| Reference checkpoints/progress and frame handling | `src/cube/training.ts`; conversion boundary in `src/cube/frames.ts`; shared visual move semantics in `src/cube/moveGuide.ts` |
| F2L targets, catalogue/exact history, slots/protected slots, completion | `src/cube/f2lTraining.ts`, `f2lTrainingCases.ts` |
| Full/2-Look OLL/PLL targets, AUF, variants or stage completion | `src/cube/lastLayerTraining.ts`, `lastLayerCases.ts`, `lastLayerTwoLookCases.ts` |
| Training presentation | `src/features/training/components/Training.tsx`, `F2LTraining.tsx`, `TrainingWorkspace.tsx` |
| F2L thumbnails | `src/cube/f2lThumbnail.ts`, `src/features/training/components/F2lCaseThumbnail.tsx` |
| Generated OLL/PLL authority | `scripts/speedcubedb.ts`, `scripts/fetchAlgs.ts`, relevant domain tests; generated data only when needed |
| Advanced F2L source authority | Relevant authority/generator module and its tests; generated data only when needed |

Load [RUNTIME.md](RUNTIME.md) for application routing/physical ownership, [CUBE.md](CUBE.md) for frames, and [PERSISTENCE.md](PERSISTENCE.md) for historical Solve storage.

## Historical Solve to F2L Training boundary

F2L Training needs some factual information from historical solves, but the persisted `Solve` record belongs to `src/app/types.ts`.

`src/cube/f2lTraining.ts` therefore defines the narrow structural input:

```ts
F2lTrainingSolveInput
```

It contains only the solve facts required to reconstruct an F2L training target, including:

- solve ID;
- scramble;
- optional scrambled facelets;
- timed moves;
- optional grip track;
- the analysis cross face when available.

This preserves the dependency direction:

```text
Controller / persisted Solve
        |
        | structural subset
        v
F2lTrainingSolveInput
        |
        v
src/cube/f2lTraining
```

The cube layer does not import `Solve` from `src/app/types.ts`.

The same narrow structural facts are used by exact OLL/PLL training. Historical
training preserves the solve's phase boundary and recorded grip where available;
catalogue training may randomize AUF, but exact historical targets do not.

## Training lifecycle

Training owns reference algorithms, exact checkpoints, checkpoint keys and
confirmation progress. Guide construction finds each checkpoint's actual centre
orientation before calling the shared cube-domain `moveGuideForToken`; rotations,
wide turns and slices can change that frame. React previews exact checkpoint
facelets separately from live progress and never mutates runtime or physical state.
`TrainingAlgorithmGuide` maps confirmed/preview indices into the controlled shared
`MoveSequence`, retaining Training navigation and Follow current behavior.

Generic token kind, axis, layer interval, direction and half-turn representation
belong to `src/cube/moveGuide.ts`, shared with Replay; React only presents those
facts. Replay retains its recorded-action/timestamp/grip reconstruction ownership.
Its cursor counts applied actions: the token/arrow show the next instruction,
while phase move highlighting consumes the last applied action. Returning from
Training restores that cursor and speed, paused, through the existing App contract.

### Shared Training lifecycle

TrainingRuntime owns one target, setup tracker, virtual pattern, attempt timer,
move list, guide, recovery lifecycle, and result shape. Controller owns application
routing/composition and common input routing; PhysicalCubeRuntime owns the
physical CubeModel. Controller delegates Training moves
and lifecycle actions through narrow injected dependencies. The shared target
preparation pipeline preserves the direct catalogue F2L setup optimization before
falling back to `algBetween()`. Timer and Training own separate recovery cancellation
tokens and use `src/shared/recovery.ts` for the shared raw two-path calculation.
Training recovery transforms complete algorithms into the target frame. Family-specific cube modules own
target construction, references, and completion rules. F2L keeps its catalogue and
slot semantics. Last-layer targets own their training set and explicit completion
goal: orient edges, orient the last layer, permute corners, or solve the cube.
Completion and reference validation use that target goal after solver-frame and
centre normalization, with F2L required to remain solved.

Training targets loaded virtually use a separate ephemeral pattern. The normal
`CubeModel` remains the application's belief about the physical/normal cube.
Training live state is ephemeral. Completed attempts may be persisted as dedicated
`TrainingAttempt` records, but never become normal `Solve` records or normal solve
statistics.

Full OLL/PLL catalogue data is generated from SpeedCubeDB, behaviourally validated
ahead of time, and checked into `src/cube/algBank.generated.ts`. The 2-Look OLL/PLL
catalogue is checked-in J Perm-derived source data in
`src/cube/lastLayerTwoLookCases.ts`. Neither source is fetched at application
runtime. Both sets use this same TrainingRuntime-owned lifecycle.

Settings independently select the catalogue for OLL and PLL catalogue Training
and Random Case selection; both default to Full. Changing the active family's set
cancels its target/attempt while preserving family and setup/virtual mode.
Historical exact OLL/PLL step practice retains Full case/reference and completion
semantics, independently of these settings; solve analysis is unchanged.

Do not model 2-Look OLL/PLL as a subset or alias of Full cases. This rejected
alternative cannot represent the stage-specific recognition cases and completion
boundaries (orient edges, permute corners). Aliases would make targets,
completion, thumbnails, and random training incorrect.

2-Look first-look catalogue targets are projections over the existing Full
OLL/PLL catalogue rather than one canonical complete cube state. OLL
edge-orientation cases derive their variants from all Full OLL states with the
corresponding dot/opposite/adjacent edge arrangement. PLL corner-permutation
cases derive their variants from Full PLL states whose corner stage is solved by
the corresponding J Perm Diagonal/Headlights algorithm. Classification excludes
states whose corners are already permuted up to AUF, including generated EPLL
setups with an AUF offset; Training completion still requires exact corner
alignment to centers in the normalized Training frame.

The selected 2-Look case owns the recognition identity, authoritative J Perm
core algorithm, and completion goal. The Full-case variant supplies the
downstream state that is irrelevant to that first look, which may include a
second-look skip. References search leading U alignments independently of the
target's physical AUF; PLL first-look references also include a final AUF when
required to reach exact corner completion. Both alignment moves belong to the
executable reference and its Training execution/STM result.

The cube domain derives and validates variant pools and constructs concrete
targets. Live catalogue attempts uniformly select a Full-case variant and
independently randomize AUF through one TrainingRuntime helper used by selection,
Again, and virtual automatic reload. Random Case continues to select among the
10/6 visible 2-Look identities before choosing a variant. Library previews use a
deterministic representative and mask irrelevant state.

### Physical versus virtual Training state

The normal `CubeModel` continues to represent the physical or normal keyboard-driven cube.

Virtual Training practice uses a separate ephemeral TrainingRuntime-owned pattern.

A selected F2L, OLL, or PLL training target must not replace the normal `CubeModel`.

Replacing it would conflate:

- desired training state;
- actual physical state;
- hardware synchronization;
- timer state;
- mode switching.

### Training from solve review

A historical F2L, OLL, or PLL step may be turned into an exact training target.

That operation consumes the narrow historical-solve facts described by `F2lTrainingSolveInput`; it does not redefine the persisted Solve model or normal solve-analysis ownership.

Completed exact solve-step attempts retain their source Solve/step identity in
Training history, independently of whether that Solve is still present. They
remain outside ordinary Timer history/statistics and do not affect catalogue mastery.

## Single and Drill activities

```text
Training
├── Single
│   ├── Setup cube
│   └── Virtual case
└── Drill
    └── Virtual case only
```

Activity and case mode are separate concepts. Both activities use the same
TrainingRuntime target construction, virtual pattern, move handling, completion,
reference matching and completed-attempt callback. Exact solve-step practice always
stops Drill and switches to Single. Single retains manual case selection,
Random/Review, Again, guide previews and virtual auto-reload with result preservation.

Drill current configuration is ephemeral runtime state: one current catalogue family/context,
selected case pool and Sequence/Random/Weighted worst strategy. F2L pools retain
Basic/Advanced library and position; OLL/PLL pools retain Full/2-Look set. Cards toggle
membership rather than loading targets. Select all/Clear operate on that catalogue.
Sequence cycles in catalogue display order and starts over on each run. Random is
uniform; Weighted worst uses only the selected pool and reads Controller's latest
Training history at each round. Both random strategies exclude the previous case
when alternatives exist. Pure selection lives in `trainingDrill.ts`, without target
construction, UI clocks or persistence.

Weights start at Practised 1, Learning 3, New 4, Needs review 6. Positive median STM
delta adds at most 4. Timing regression adds at most 4 using `(ratio - 1) * 5`,
preferentially from Drill case time, otherwise registered move span. Current-run solved weakness uses the same capped delta/timing adjustments, taking
the stronger historical/run signal to avoid double-counting completed attempts that
already entered history. Each skip in a case's last five run outcomes adds 6, capped
at 12. Neither skips nor run signals alter persisted case status. The draw walks
cumulative positive weights using an injected RNG, still excluding immediate repeats.

Start captures the catalogue context, forces virtual mode, clears Single state and
begins a fixed 2-second countdown. No target is prepared or revealed early. Expiry
constructs the next catalogue target through the shared preparation path, increments
the round and records reveal time. Physical turns manipulate the separate virtual
pattern; the physical CubeModel is never replaced. During ready/solving the cube is
visible but its identity, group, metrics, algorithms, token guide and arrows are
concealed. Library styling shows only pool membership, never the active answer.

Completion publishes/persists one Drill fact and keeps the completed target, result
and references visible during the next 2-second countdown. The next expiry replaces
the virtual target and clears the result. Skip is available only before any turn;
it reveals identity/references and begins the same countdown without persisting an
attempt. Stop cancels every phase, abandons incomplete work and clears target/result. It
retains pool/strategy and enters an explicit ephemeral summary when outcomes exist;
otherwise it returns to configuration. Family changes stop and clear incompatible
pools. F2L library changes clear pools; position changes preserve case names during
configuration. Neither can change during a run. Changes to the active last-layer set
stop/clear Drill, even during initial countdown. Leaving Training cancels the run/summary entirely while retaining configuration; an
active Drill cannot detour into Statistics.

`TrainingResult.caseTimeMs` measures case reveal to detected completion, including
recognition and registered turns. It is null for Single. Persisted attempts record
`activity: single | drill` and this case time. The compatibility field `elapsedMs`
means registered move span (first registered cube move to last), not full case time
or pure recognition time; a one-move span is zero. Derived metrics and UI use
Move span/Best move span/Recent move span. Drill result case time is primary.

### Current run feedback and summary

Drill distinguishes configuration, running and completed summary explicitly within
TrainingRuntime. Start resets ephemeral outcomes and the sequence cursor while
retaining pool/strategy. Solved outcomes retain case ID, case time, move span, STM,
delta and completion timestamp, and also emit the existing persisted TrainingAttempt.
Skip appends only an ephemeral skipped outcome; it remains outside persisted mastery.
Selection reads both current outcomes and Controller's latest history each round.

Pure `trainingDrillSummary` derives completed round/solved/skipped counts and solved-only
average/best case time and average STM. The active round counter includes the revealed
case; completed counts exclude incomplete work. While running, presentation replaces
the full catalogue with compact run context without changing the selected pool.
Answers remain concealed until completion/skip, and the cube remains prominent.

Stopping after outcomes enters summary. Weak-case ranking remains restricted to the
selected catalogue: most skips, largest run time regression (both historical best case time
and run average, taking the larger regression), positive recent median STM delta, historical review status,
then catalogue order. Display/action pools are bounded to five meaningful weak cases.
Summary retains its captured family/library/position or family/set context even when
Settings changes. Exiting resumes current catalogue rules and clears incompatible IDs.

Drill weak cases configures those IDs with Weighted worst; Repeat same set
retains pool/strategy. These actions clear previous outcomes and return to configuration,
requiring explicit Start. No persistent DrillSession or skip record exists;
reload discards outcomes/summary, retaining only solved TrainingAttempt facts.

Ready recognition with no countdown does not require continuous RAF. The reveal
timestamp stays independent of ticks; first move restarts the shared clock, and case
time includes the entire unticked wait. Solving and countdown require ticks.

## Personal algorithms and catalogue identity

`TrainingCatalogueIdentity` in `app/types.ts` owns durable catalogue identity.
`app/trainingCatalogue.ts` encodes the shared JSON tuple key: F2L uses family,
library, case name and position; OLL/PLL uses family, Full/2-Look set and case ID.
AUF does not split an identity. Performance, review, weighting, preference storage
and case-card markers share this key.

Canonical references are repository/source authority. One user-owned
`TrainingAlgorithmPreference` per catalogue key stores a stable source/core
algorithm, catalog/custom source, optional note and timestamps. It is independent
of Sessions, Settings, history and Saved Drill presets. The Training workflow
validates syntax and catalogue completion before explicit save or JSON import:
F2L uses the normal solved base and protected-slot semantics; last-layer validation
checks every relevant variant and AUF with its stage completion goal.

Controller owns the preference Store and serializes saved-drill/preference writes
through one Training configuration mutation queue, separate from attempt writes.
Writes persist before publication. Save captures its catalogue identity; after
navigation it updates the global Store but refreshes only a still-matching target.
Export/import wait for configuration mutations and completed-attempt writes.

TrainingRuntime receives a narrow preference lookup and derives a separate ephemeral
resolved reference for the concrete target. It owns no preference persistence/key/note.
The source algorithm stays stable; the executable algorithm includes target-specific
alignment. Canonical references and ranks remain unchanged. Stale unresolved
preferences fall back to canonical guidance and remain available for editing/removal.
Exact solve-step practice never inherits catalogue preferences.

Single guidance, checkpoints and arrows use My algorithm when resolved, otherwise
canonical rank 1. Refreshing a preference uses the existing target: setup, pattern,
AUF, variant, lifecycle and completed result remain unchanged. Editing/refresh is
refused once solving starts, so an attempt's benchmark stays fixed. Drill conceals
answers during recognition/solving but evaluates the personal benchmark and reveals
it after completion; management remains Single catalogue presentation only.

Reference matching evaluates canonical and preferred references independently using
existing strict checkpoint semantics. STM priority is matched preferred, matched
canonical, then observed. Canonical `delta` retains its historical meaning.
Results snapshot preferred executable algorithm, STM, match and delta; attempts
persist the nullable preferred numeric/match facts from that completed snapshot.
Adaptive efficiency and ephemeral Drill outcome delta use `preferredDelta ?? delta`
from each attempt, never today's preference applied retroactively. Timing is unchanged.

## Saved Drill presets

```text
Drill configuration
  ephemeral current configuration
  optional persisted named TrainingDrillPreset
```

`trainingDrillPresets.ts` constructs and edits configuration-only records; Controller
owns their separate Store and delegates persistence to `db.ts`. Each record has a
stable UUID, a trimmed name (1-80 characters), creation/modification timestamps,
discriminated catalogue context, selected case IDs and strategy. Duplicate names
are allowed; context metadata distinguishes entries. Presets remain single-family
and single-catalogue. F2L owns Basic/Advanced library and position; OLL/PLL owns
Full/2-Look. The durable context/strategy value contracts live in `app/types.ts`
and are reused by `trainingDrill.ts`; selection policy stays in Training.

Loading restores context and hydrates the existing TrainingRuntime configuration,
without selecting/revealing a case or starting a countdown. OLL/PLL loads synchronize
the applicable Settings preference through a narrow Controller boundary. The prospective
Settings record persists before Settings/catalogue/runtime publication. A failed write
leaves both Stores and the selected pool unchanged. Controller exposes a preset-application
busy Store and refuses Drill Start until loading finishes;
there is no hidden preset catalogue preference alongside Settings. The other family's
preference remains unchanged. F2L loads restore remembered library and position.

The runtime owns no preset ID/name and has no link back to the record. Editing a
loaded pool changes only current configuration; Update explicitly replaces context,
cases and strategy while retaining ID/name/creation time. Rename changes only the
name/modification time. Loading does not edit timestamps. Delete removes the record
without changing current configuration. Record edits persist before Store publication;
failed writes report through Controller's error path and retain the existing Store.

Save/Update/Load require configuration, never a run or summary. Saved-drill controls
subscribe once to Controller.trainingDrillPresets and manage only local presentation
selection/inline editors. Weak-case summary actions and Repeat same set remain
ephemeral; their configurations can subsequently be saved explicitly. Runs, outcomes,
countdowns, targets, guides, patterns and summaries never enter preset records.

## Completed history and catalogue review

TrainingRuntime emits one `CompletedTrainingAttempt` callback containing the
completed target, activity, mode and result, before virtual auto-reload can replace or
randomize the target. Again, resets and abandoned attempts do not emit completion.
Runtime does not write IndexedDB. Controller asks `trainingHistory.ts` to construct
a UUID/timestamped `TrainingAttempt`, appends it immediately to its separate
`trainingAttempts` Store, and saves it asynchronously. Persistence errors use the
application error path without discarding the completed result. Backup/import wait
for pending writes; JSON import refreshes the history Store. Session switching does
not replace that Store. Actual moves/results are retained; recommended algorithms
remain catalogue authority rather than duplicated historical data.

Catalogue keys in `trainingPerformance.ts` encode F2L library, case name and
position, or OLL/PLL family, Full/2-Look set and case ID. AUF/variant changes do not
split a last-layer identity. Exact solve-step targets have no catalogue key and
never silently update catalogue mastery, even for recognizable Full OLL/PLL cases.

Per-case performance uses all catalogue attempts for count and best positive move
span/case time and best STM, and the latest five (timestamp then ID) for recent
medians and delta. Invalid/nonpositive spans or case times and null deltas do not
become zero-valued PBs/efficiency.
New means no attempts; Learning means fewer than three. With at least three,
Needs review means positive recent median delta or recent median timing exceeding
best by more than 20% (Drill case time when available, otherwise move span); otherwise
the label is Practised. These are transparent practice guidance, not a formal mastery percentage.

The pure Review selector chooses uniformly among unseen cases, then lowest-count
under-practised cases (oldest first), then review cases ordered by larger median
delta, larger time-regression ratio and oldest practice. Missing metrics rank
behind available poor performance; stable catalogue order breaks remaining ties.
Maintenance chooses the least recently practised case. The current case is avoided
within the selected tier/minimum-count pool when alternatives exist, without
skipping higher-priority coverage tiers. Controller delegates the selected identity
to existing runtime selectors; performance policy never builds targets.

Random case supports all families uniformly within the selected catalogue.
F2L Random/Review retain Basic/Advanced library and position; OLL/PLL retain Settings'
Full/2-Look choice. Explicit Next review is available after catalogue completion;
Again repeats the same identity and mode. Exact practice keeps Again and its return
to Solve review, with no catalogue metrics or result-level Next review. Libraries
subscribe once to history and pass memoized metrics to cards. Review remains Training
feature logic, separate from Statistics; it adds no automatic case advancement.

## F2L catalogue thumbnails

F2L catalogue thumbnail data and rendering have separate responsibilities.

`src/cube/f2lThumbnail.ts` adapts checked-in canonical thumbnail data into an `F2lThumbnailModel` containing:

- facelet colours;
- a per-facelet `coloured` mask.

The Basic and Advanced libraries use the same model shape and presentation path.

`src/features/training/components/F2lCaseThumbnail.tsx` is a renderer. It colours facelets selected by the model and renders all others with the common muted presentation.

The React renderer must not recreate Basic-versus-Advanced case logic that belongs in the domain/generated thumbnail authority.

Generated thumbnail maps are data products, not general architecture discovery entrypoints.

## Rejected alternatives

### Separate Drill runtime or physical setup Drill

A second runtime would duplicate shared targets, patterns, turns, completion,
references and persistence, allowing cube semantics to diverge. Physical setup
between every round defeats the rapid cycle; Drill resets the ephemeral virtual
case while the real smart cube only supplies turns.

### React-owned countdown or answers while solving

Countdown is lifecycle state and must cancel consistently with navigation. Runtime
owns it through Controller's existing RAF, not a React timer or another RAF. Showing
algorithms/arrows during a case would turn recognition practice into guided
execution; answers appear only after solving or Skip.

### Saved drills in Settings or persisted DrillSession records

Settings owns singular application preferences. Saved drills are independently named
CRUD records with stable IDs and backup/import merging; hiding the collection in
Settings blurs ownership and worsens record-level merge semantics. Current pools,
strategy cursors and rounds remain ephemeral. Completed rounds already produce
TrainingAttempt records; presets store reusable configuration, never historical runs.

### Preset identity in TrainingRuntime or automatic preset updates

Loaded presets are templates, not live bindings. Runtime owns only hydrated
configuration; retaining preset identity as source-of-truth or automatically saving
selection changes would turn temporary experiments into unwanted persistent edits.
Update is explicit.

### Automatically starting preset loads

Loading chooses configuration. Start drill is the explicit countdown/runtime boundary.

### Reinterpreting saved IDs using the current catalogue

Saved IDs mean cases within their own library/position or family/Training set.
Restore that context first; current Settings/library must not reinterpret them.

### Run outcomes in presets

Preset means reusable configuration. Run outcomes remain ephemeral, with solved
rounds independently persisted as TrainingAttempt facts.

### Reveal-to-first-move as pure recognition time

Smart cubes publish registered move events, not reliable physical motion onset.
Only reveal-to-completion case time is claimed as a full observed Drill timing fact.

### Persist preferences, Timer solves or Session-scoped mastery for Training history

Settings is preference state, not historical user activity. Training attempts have
different lifecycle/meaning from Solve records and must not contaminate Timer
history/statistics. Catalogue identity is independent of Timer Session/Event
ownership, so switching Sessions cannot reset mastery. Dedicated global
`TrainingAttempt` records are the persisted boundary.

### TrainingRuntime writes IndexedDB

Rejected because live runtime orchestration must remain separate from persisted
workflows. Runtime emits completion; Controller composes TrainingHistory and storage.

### Exact solve-step practice silently updates catalogue mastery

Rejected because exact targets preserve solve-specific state/grip/slot, and F2L
targets do not necessarily identify the selected catalogue/library. All completed
exact attempts persist, but only catalogue-origin records contribute to review.

### One universal Training/Replay timeline or a second arrow interpreter

Do not merge `TrainingGuide` and `ReplayAction`: expected reference checkpoints
and confirmation progress differ from recorded physical turns, inserted grip
rotations and timestamps. A universal timeline would obscure those meanings
without a shared source of truth. Do not duplicate move-arrow interpretation in
Replay React code either; it would create a second notation/frame implementation
and allow arrows to drift. Share only cube-domain visualization and controlled
token presentation, as described in [CUBE.md](CUBE.md).

### Mirror TrainingRuntime state into AppState

Rejected because it creates two observable sources of truth and retains
high-frequency application-root rerenders. Training state belongs only to
TrainingRuntime; Controller owns routing and composition.

### One generic case-training domain object

Rejected because F2L pair/slot/protected-slot semantics and OLL/PLL stage-completion
semantics differ materially. The lifecycle is shared; domain meaning remains in
`f2lTraining.ts` and `lastLayerTraining.ts`.

### Separate OLL and PLL Controller states

Rejected:

```text
Create separate Controller states and move pipelines for F2L, OLL, and PLL.
```

Reason:

```text
Setup tracking, virtual-pattern isolation, recovery, timing, result handling, and physical cube ownership are the same lifecycle. Parallel implementations would duplicate ownership and drift.
```

### One canonical downstream state for 2-Look first looks

Rejected:

```text
Use one canonical downstream state, for example always Sune after OLL edge
orientation or always Ua after PLL corner permutation.
```

Reason:

```text
Repeated training would expose the same irrelevant stickers and allow the user
to learn one complete cube state instead of the recognition feature the 2-Look
case represents. It also fails to model the variety encountered in real Full
OLL/PLL states.
```

### Replacing CubeModel with an F2L target

Rejected:

```text
Put the selected F2L training target directly into the normal CubeModel.
```

Reason:

```text
CubeModel represents the physical/normal cube state. Replacing it with a
desired training state would desynchronize hardware state and conflate physical
state with training state.
```

Virtual Training keeps separate ephemeral state instead.

### Persist skipped attempts or a persistent DrillSession

Rejected for this pass: TrainingAttempt means a completed Training solve. Skip affects
active practice but cannot silently change that historical/mastery contract. Solved
rounds already persist independently; a durable session model needs an explicit
historical-session browsing requirement. Ephemeral outcomes satisfy current feedback.

### Continuous recognition RAF or React-calculated session policy

A reveal timestamp is sufficient for full case time; frame publication while merely
looking at a case adds work without correctness. Controller's existing RAF ticks only
solving/countdown. Summary and weak-case ranking are pure Training policy, reusable by
runtime selection and tests, not a second React state machine.

### Automatically start weak-case/repeat drills

Rejected: summary actions configure the next set. Explicit Start keeps the user in
control of when the next countdown begins.


### Personal algorithms in generated data, Settings or Saved Drill presets

Rejected: generated catalogues are repository authority, Settings is one application
preference record, and Drill presets select cases/strategy. Personal algorithms are
a separate keyed user collection applying globally to future catalogue practice.

### Persist AUF-adjusted algorithms or canonical ranks

Rejected: a live executable depends on randomized target orientation, and ranks can
change with catalogue ordering. Persist stable source/core notation and resolve the
concrete target independently, including alternate PLL recognition angles/final AUF.

### Replace canonical rank 1 or create another matcher

Rejected: recommendation and personal preference are distinct facts. Keep references
separate and reuse existing Training guide/checkpoint/reference execution machinery.

### Apply preferences to exact solve-step practice

Rejected: exact practice preserves historical state, grip, boundaries and completion
meaning rather than catalogue preference ownership.

### Multiple personal algorithms per case

Rejected for this phase: one My algorithm is the benchmark per catalogue identity;
canonical alternatives remain available without another user algorithm library.
