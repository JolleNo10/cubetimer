# Training runtime and family semantics

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Training lifecycle, setup, virtual pattern, attempts, recovery, retry | `src/features/training/TrainingRuntime.ts` and its tests |
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
Training attempts are ephemeral and never become normal `Solve` records or
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

Training attempts remain outside ordinary timer history and statistics.

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
