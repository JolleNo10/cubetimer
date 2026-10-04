# Current system architecture

This is the architecture entry point, system map and source-routing guide. Detailed current-state rules live in the focused documents below. Update the owning document when ownership, contracts or durable decisions change.

## Agent loading

| Change area | Architecture and first sources |
| --- | --- |
| Composition, physical/device runtime, Timer, input routing, stores, React integration | [RUNTIME.md](RUNTIME.md); `src/app/Controller.ts`, the named runtime or component |
| Training lifecycle, target preparation, physical/virtual modes, family semantics, guide, recovery or Training UI | [TRAINING.md](TRAINING.md); `src/features/training/TrainingRuntime.ts`, the relevant cube target module |
| CubeModel meaning, facelets, notation, orientation/frame conversion, grip, analysis or recognition | [CUBE.md](CUBE.md); the specific `src/cube` module |
| Session/EventId, persisted history/repair, Settings, JSON/CSV, Statistics history boundary | [PERSISTENCE.md](PERSISTENCE.md); the relevant feature service or adapter |
| Build/browser checks | `package.json`, `vite.config.ts`, the relevant script |

Generated case/algorithm/thumbnail datasets are not discovery anchors. Open them only for work on their contents or authority pipeline. Stop loading when ownership, affected contracts and the safe change are understood.

## System overview

Cubetimer is a browser application built around one long-lived application controller.

```text
SmartCube -> PhysicalCubeRuntime -> Controller routing <- Keyboard / UI
                     |                    |
                 CubeModel       +--------+--------+
                                 |                 |
                            TimerRuntime     TrainingRuntime
                                 |                 |
                              cube/domain mechanics
                                 |
                    ownership stores / narrow events
                                 |
                              React UI

Controller -> SessionService / SolveHistory / DataTransfer -> db.ts
```

The important ownership direction is:

- hardware transport feeds facts into PhysicalCubeRuntime;
- user interactions invoke Controller operations;
- the Controller owns cross-cutting runtime orchestration;
- `src/cube` owns cube/domain computation;
- application contracts and feature services own persisted workflows; infrastructure owns adapters;
- narrow stores and Controller events publish runtime state;
- React presents state and initiates actions.

React components are not a second application state machine.

## Layers and source ownership

`src/main.tsx` boots the application. Files are grouped by extracted ownership:

```text
src/
  app/
    App.tsx, Controller.ts, PhysicalCubeRuntime.ts
    useController.ts, types.ts, settings.ts, scrambleProvider.ts, components/
  features/
    timer/           TimerRuntime.ts, components/
    training/        TrainingRuntime.ts, components/
    sessions/        sessionService.ts
    history/         solveHistory.ts, repair.ts, components/
    data-transfer/   dataTransfer.ts, solveCsv.ts, csv.ts
    statistics/      state/, components/
  infrastructure/
    bluetooth/       smartCube.ts (transport)
    persistence/     db.ts (IndexedDB adapter)
  shared/
    store.ts, recovery.ts, time.ts, ui/
  cube/              pure cube domain and clearly named generated datasets
```

Dependency direction is React -> application/runtime -> persistence or cube domain.
Feature modules may depend on cube domain; cube domain must not depend on app,
features, React or persistence. Shared UI consumes application facts and initiates
actions through the Controller facade. Shared state utilities do not compose runtimes.

`src/cube` stays together: behavioral modules are the discovery anchors, and generated
data retains its existing names and location. Internal domain folders are introduced
only when they improve navigation enough to justify moving their consumers.

## Durable invariants

The following are current architectural rules.

1. **The Controller owns cross-cutting runtime orchestration.**
   Do not reproduce its timer, session, training, hardware, or solve state machines inside React components.

2. **A Session is the single source of truth for `EventId`.**
   `Solve` and `Settings` must not duplicate active event ownership.

3. **A historical Session retains the event under which its solves were recorded.**
   Changing event after history exists creates a new Session rather than relabelling the old history.

4. **Session/event context cannot change during inspection or an active solve.**

5. **`src/cube` does not depend on application, feature or infrastructure modules.**
   Domain functions receive narrow structural inputs instead of importing persistence records.

6. **The persisted `Solve` record remains owned by the application in `src/app/types.ts`.**
   Do not move persistence/session/interchange metadata into the cube domain for convenience.

7. **`SmartCube` owns hardware transport, not application policy.**

8. **The normal `CubeModel` represents the physical or normal keyboard-driven cube.**
   Training targets and virtual F2L state must not replace it.

9. **Timer, Training, and Statistics live state remain isolated.**
   Statistics cannot hide active timing, and Training attempts must not leak into ordinary solve history or statistics.

10. **Persistent application records flow through the state/persistence layer.**
    Components must not become direct IndexedDB owners.

11. **Raw solve facts and derived analysis remain distinguishable.**
    Analysis may be repaired or rebuilt from retained facts where supported.

12. **Narrow stores and Controller events are preferred for high-frequency runtime updates.**

13. **Generated case, algorithm, and thumbnail data is not a general architectural abstraction or discovery starting point.**

14. **Import may merge a Session by id only when its EventId is compatible with the existing Session.**
    A conflicting EventId must never overwrite a Session that has solve history.

15. **Statistics are event-safe and read-only with respect to Timer context.**
    Cross-session analytics resolve EventId through Session identity and never mutate the selected Timer Session.
    Rolling average windows always belong to one Session; All-Sessions views merge
    achieved Session-local windows.

16. **TrainingRuntime is the single owner of the ephemeral Training state machine and observable Training state.**
    Controller owns application routing, composes PhysicalCubeRuntime and delegates
    Training lifecycle/input operations to TrainingRuntime.
    Every Training target carries an explicit `family` discriminator; runtime and
    presentation must not infer family from unrelated field presence.
    The lifecycle is generalized while F2L target/slot/protected-slot and last-layer
    stage-completion semantics remain family-owned in the cube domain. Training
    reference/checkpoint/progress mechanics remain in `src/cube/training.ts`; shared
    frame conversions belong to `src/cube/frames.ts` as described in [CUBE.md](CUBE.md).
    Remembered F2L library/position live in `f2lSelection`; OLL/PLL training-set
    preferences remain Settings-owned.

17. **Last-layer catalogue authority is offline and explicit.**
    Full OLL/PLL catalogue data is generated and validated ahead of time from
    SpeedCubeDB and checked into the repository. 2-Look OLL/PLL curriculum data
    is checked-in J Perm-derived authority. 2-Look first-look concrete variants
    are derived from the checked-in Full catalogue at runtime in the cube domain.
    The application does not fetch either external source at runtime.

18. **Persisted workflows are separate from live runtime orchestration.**
    SessionService, SolveHistory, and DataTransfer own persisted application-data
    workflows and return explicit results. Controller owns Timer/Training runtime
    policy and applies the runtime consequences of those results.

19. **PhysicalCubeRuntime owns physical/device/grip facts; TimerRuntime owns Timer/solve lifecycle.**
    TrainingRuntime owns Training lifecycle. Controller composes and coordinates
    them. There is exactly one physical CubeModel, consumed by both feature runtimes.

20. **Generic move-visualization semantics are shared cube-domain behavior.**
    `src/cube/moveGuide.ts` owns token kind, axis, layer interval, direction and
    half-turn representation for Training and Replay. Training owns reference
    checkpoints/progress; Replay owns recorded action/timestamp/grip reconstruction;
    React only presents these facts through the shared arrow renderer and controlled
    move sequence. Do not merge `TrainingGuide` and `ReplayAction` into a universal
    timeline: expected checkpoints and recorded turns have different semantics and
    no shared source of truth. Do not duplicate notation/frame interpretation in
    Replay presentation, which would let arrows drift. See [CUBE.md](CUBE.md).
