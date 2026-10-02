# Current system architecture

This document is the architecture entry point for cubetimer repository work.

It describes the system as it exists now. It is not a change proposal, roadmap, ADR, or feature specification.

Update it when a documented architectural fact becomes incorrect or when a durable architectural choice changes, such as ownership, dependency direction, source of truth, persistence contract, or a stable invariant.

## Agent loading

Start with the smallest relevant area below. Read additional areas only when the requested change crosses their boundary.

There are currently no feature-specific architecture documents under `docs/architecture/`.

| Change area | Start here |
| --- | --- |
| Application bootstrapping or global composition | `src/main.tsx`, `src/App.tsx`, `src/hooks/useController.ts` |
| Timer lifecycle, scramble lifecycle, session context, smart-cube integration, or top-level runtime behavior | `src/state/controller.ts`, `src/state/controller.test.ts` |
| Session/event ownership or event switching | `src/state/types.ts`, session methods in `src/state/controller.ts`, `src/components/Header.tsx`, `src/state/db.ts` |
| Durable Session, Solve, or Settings records | `src/state/types.ts`, `src/state/db.ts` and related tests |
| Statistics, averages, projections, or solve-history comparisons | `src/state/stats.ts`, `src/components/StatsPanel.tsx`, `src/components/SolveComparison.tsx` and related tests |
| JSON backup/import compatibility | backup/import methods in `src/state/controller.ts`, migration functions in `src/state/db.ts` |
| Solve-analysis CSV import/export | `src/state/solveCsv.ts`, `src/state/csv.ts` and related tests |
| Bluetooth or GAN cube connection | `src/bluetooth/smartCube.ts` and the relevant integration in `src/state/controller.ts` |
| Cube state, facelets, moves, notation, orientation, or grip | the specific module under `src/cube/` and its matching tests |
| CFOP solve analysis or case recognition | `src/cube/analysis.ts`, `src/cube/recognise.ts`, related domain modules and tests |
| Scramble tracking or generation | `src/cube/scramble.ts` and relevant controller integration |
| Cross, XCross, or Slow Solve coaching | `src/cube/crossSolver.ts`, `src/cube/crossPlans.ts`, `src/cube/crossScramble.ts`, `src/components/CoachPanel.tsx` as applicable |
| F2L Training runtime and targets | `src/state/controller.ts`, `src/cube/f2lTraining.ts`, `src/cube/f2lTrainingCases.ts`, `src/cube/f2lCases.ts`, `src/components/F2LTraining.tsx` and relevant tests |
| F2L catalogue thumbnails | `src/cube/f2lThumbnail.ts`, `src/components/F2lCaseThumbnail.tsx`, generation scripts/maps and their tests |
| Advanced F2L source authority or generated case data | the relevant Advanced F2L authority/generation module, its generator script, and focused tests |
| Solve result or step presentation | `src/components/SolveResult.tsx`, `src/components/StepBreakdown.tsx` and related tests |
| Replay behavior or replay highlighting | `src/components/ReplayDialog.tsx`, `src/components/replayTimeline.ts`, `src/components/replayFocus.ts`, `src/components/CubeView.tsx` and focused tests |
| Styling or presentation-only changes | the relevant component and `src/styles/global.css` |
| Build, runtime, or browser checks | `package.json`, `vite.config.ts`, relevant files under `scripts/`, and Docker files as applicable |

Generated case, algorithm, and thumbnail datasets are not general discovery anchors. Load them only when the task specifically concerns their generated contents or their authority/generation pipeline.

Stop discovery once ownership, data flow, affected contracts, and the required change are understood.

## System overview

Cubetimer is a browser application built around one long-lived application controller.

```text
Smart cube                    Keyboard / UI
    |                              |
    v                              |
SmartCube                          |
adapter                            |
    |                              |
    +-----------> Controller <-----+
                    |
        +-----------+------------+
        |           |            |
        v           v            v
   cube/domain   persistence   stores/events
      logic
        \           |            /
         \          |           /
          +---------+----------+
                    |
                    v
                 React UI
```

The important ownership direction is:

- hardware transport feeds facts into the Controller;
- user interactions invoke Controller operations;
- the Controller owns cross-cutting runtime orchestration;
- `src/cube` owns cube/domain computation;
- `src/state` owns persisted application records and persistence;
- narrow stores and Controller events publish runtime state;
- React presents state and initiates actions.

React components are not a second application state machine.

## Layer ownership

```text
src/cube
  cube and puzzle state
  moves and notation
  scrambles
  orientation and grip transformations
  solve analysis
  cross/F2L/OLL/PLL domain logic
  narrow historical-solve inputs required by training

src/bluetooth
  smart-cube transport
  protocol event acquisition
  hardware state
  move timestamp fitting

src/state
  Controller/application orchestration
  persisted Session and Solve records
  Settings
  IndexedDB
  migrations
  statistics
  JSON backup/import
  CSV import/export coordination

src/components
  React presentation and interaction
```

The dependency direction between the domain and persistence layers is deliberate:

```text
src/state -> src/cube

src/cube -X-> src/state
```

`src/cube` must not import persisted application records merely because domain logic needs a subset of their data.

## Runtime ownership

`src/main.tsx` creates one long-lived `Controller`, calls `controller.init()`, and exposes it to React through `ControllerContext`.

`src/state/controller.ts` owns cross-cutting application behavior, including:

- timer phases;
- scramble lifecycle;
- smart-cube and virtual-cube move handling;
- physical cube-state coordination;
- inspection and solve timing;
- session selection and event context;
- solve recording;
- solve-analysis orchestration;
- grip/orientation tracking;
- Timer/F2L Training area transitions;
- F2L Training runtime state;
- persistence coordination;
- application-facing runtime events.

This logic lives outside React intentionally. Cube events may arrive frequently and timing updates every animation frame.

### Observable state

`src/state/store.ts` provides the small observable `Store<T>` abstraction.

The Controller exposes:

- main application state;
- elapsed time;
- inspection time remaining;

through narrow stores.

`src/hooks/useController.ts` connects stores to React through `useSyncExternalStore`.

The Controller also exposes targeted listener seams for events such as:

- cube moves;
- grip changes;
- full pattern replacement;
- view recentering;
- completed solve recording.

High-frequency or narrowly scoped events should not require unrelated application-wide React updates.

### React responsibility

`src/App.tsx` owns presentation-level state such as:

- which result is open;
- selected historical solve;
- replay dialog state;
- analysis dialog state;
- temporary return context when entering F2L Training from a result or replay.

That state controls presentation and navigation.

It must not duplicate the timer, cube, session, training, or persistence state machines owned by the Controller.

## Session and event ownership

A `Session` is the canonical owner of its `EventId`.

```text
Session
  id
  name
  event
  createdAt

Solve
  sessionId
  ...
```

A `Solve` does not duplicate the event.

`Settings` does not contain the active event.

The selected Session therefore determines the event context used for:

- scramble generation;
- smart-cube capability decisions;
- session history;
- statistics;
- newly recorded solves.

The Controller resolves the current event from the selected Session and falls back to `DEFAULT_EVENT_ID` only when no current Session is available.

### Changing event

Changing event preserves the meaning of existing history.

For an empty selected Session:

```text
change event
-> update that Session in place
-> persist Session
-> generate a scramble for the new event
```

For a Session that already contains a solve:

```text
change event
-> create a new Session with the requested event
-> select the new Session
-> leave existing Session and history unchanged
```

A normal manually created Session inherits the selected Session's event unless another event is explicitly supplied.

### Session-context lock

Session/event context cannot change while the timer is in:

- `inspection`;
- `solving`.

The Controller enforces this rule; the UI also disables the corresponding controls.

This prevents a running solve from changing the context under which it is being recorded.

### Switching Sessions

Selecting another Session loads that Session's solves.

If the target Session has a different event, the Controller invalidates the old scramble context and generates a scramble for the newly selected event.

Statistics shown in the normal application are therefore naturally scoped to the selected Session because the Controller's active `solves` collection contains that Session's history.

Solve-to-history comparisons additionally require matching `sessionId`.

## Cube/domain boundary

`src/cube/` contains cube/domain behavior and must remain independent of:

- React presentation;
- Bluetooth transport;
- persisted `src/state` records.

Important responsibilities include:

- `model.ts` — cube state;
- `facelets.ts` — facelet/KPattern conversion;
- `scramble.ts` — event definitions, scramble generation and scramble progress;
- `notation.ts` — move representation, timestamps and turn metrics;
- `orientation.ts`, `gyroGrip.ts`, `liveGrip.ts`, `gripTrack.ts` — orientation and held-frame behavior;
- `analysis.ts` — CFOP phase detection and solve metrics;
- `recognise.ts` and related modules — case recognition;
- cross modules — cross solving, planning and targeted scramble generation;
- F2L modules — case authority, recognition, training targets and training metrics;
- solver modules — state-to-state search and solution support.

Do not turn `src/cube` into a persistence layer or UI layer merely because those layers consume cube-domain behavior.

## Historical Solve to F2L Training boundary

F2L Training needs some factual information from historical solves, but the persisted `Solve` record belongs to `src/state`.

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

The cube layer does not import `Solve` from `src/state/types.ts`.

## Smart-cube data flow

`src/bluetooth/smartCube.ts` is the hardware adapter around `gan-web-bluetooth`.

The normal hardware path is:

```text
GAN cube
-> gan-web-bluetooth
-> SmartCube
-> Controller
-> CubeModel
-> scramble / timer / training / analysis state
-> stores and narrow Controller events
-> React presentation
```

`SmartCube` owns:

- connection and disconnection;
- protocol event subscription;
- cube moves;
- full facelet-state events;
- gyroscope readings;
- battery polling;
- hardware metadata;
- remembered MAC-address handling;
- raw move timestamp fitting support.

It reports hardware facts.

Timer policy, session policy, scramble behavior, training behavior, and solve interpretation belong outside the Bluetooth layer.

## CubeModel ownership

`src/cube/model.ts` represents the cube state the normal application currently believes to physically exist.

Smart-cube moves update it.

Normal virtual/keyboard cube moves use the same move-processing path.

A complete facelet state received from hardware may replace the pattern to resynchronize the application with the physical cube.

The physical/normal `CubeModel` has a different meaning from an F2L training target.

They must remain distinct.

## Virtual and injected input

`Controller.injectMove()` deliberately feeds a synthetic move into the same Controller move-processing seam used by smart-cube moves.

This is used by virtual cube interaction and provides tests with a way to exercise the normal runtime path without a separate implementation.

Avoid creating parallel move-processing pipelines when the existing injection seam is sufficient.

## Timer and F2L Training isolation

Timer and F2L Training are separate top-level Controller-owned application areas:

```text
timer
f2l
```

Switching areas resets or cancels incompatible live state.

Training turns must not enter the normal timer lifecycle or ordinary solve history.

### Physical versus virtual F2L state

The normal `CubeModel` continues to represent the physical or normal keyboard-driven cube.

Virtual F2L practice uses a separate ephemeral Controller-owned pattern.

A selected F2L training target must not replace the normal `CubeModel`.

Replacing it would conflate:

- desired training state;
- actual physical state;
- hardware synchronization;
- timer state;
- mode switching.

### Training from solve review

A historical F2L step may be turned into an exact training target.

That operation consumes the narrow historical-solve facts described by `F2lTrainingSolveInput`; it does not redefine the persisted Solve model or normal solve-analysis ownership.

F2L Training attempts remain outside ordinary timer history and statistics.

## F2L catalogue thumbnails

F2L catalogue thumbnail data and rendering have separate responsibilities.

`src/cube/f2lThumbnail.ts` adapts checked-in canonical thumbnail data into an `F2lThumbnailModel` containing:

- facelet colours;
- a per-facelet `coloured` mask.

The Basic and Advanced libraries use the same model shape and presentation path.

`src/components/F2lCaseThumbnail.tsx` is a renderer. It colours facelets selected by the model and renders all others with the common muted presentation.

The React renderer must not recreate Basic-versus-Advanced case logic that belongs in the domain/generated thumbnail authority.

Generated thumbnail maps are data products, not general architecture discovery entrypoints.

## Solve data flow

For a native smart-cube solve, the important factual inputs are:

```text
scramble / starting cube state
+ timed move stream
+ available grip/orientation information
```

Conceptually:

```text
scramble state + timed moves + grip information
-> analyseSolve(...)
-> Solve
-> IndexedDB
-> Controller active state
-> result / history / statistics UI
```

Presentation components do not independently own or persist canonical solves.

## Solve model

A `Solve` belongs to exactly one Session through `sessionId`.

Raw timing and penalty are separate.

A smart-cube Solve can retain:

- scramble;
- timed move stream;
- starting facelets;
- encoded grip information;
- derived `SolveAnalysis`;
- optional interchange/import metadata.

The Session supplies the event context; the Solve does not carry a duplicate `EventId`.

### Derived analysis

Raw solve facts are authoritative.

`SolveAnalysis` is derived and rebuildable.

When stored analysis uses an obsolete/unreadable shape, loading may rebuild it from retained scramble/move facts and persist the repaired record.

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
- case;
- F2L slot;
- move-stream boundaries.

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

## Persistence

`src/state/db.ts` owns IndexedDB access.

The current database is:

```text
name: cubetimer
schema version: 1

stores:
  sessions
  solves
  settings
```

The current ownership model does not require an IndexedDB schema-version bump because the existing stores can hold the changed record shapes.

### Persisted records

`src/state/types.ts` defines the current:

- `Session`;
- `Solve`;
- `Settings`.

Components do not write IndexedDB directly.

Persistence flows through the state/Controller layer.

### Legacy normalization

Current load/import normalization removes obsolete duplicate ownership:

- missing or invalid `Session.event` becomes `DEFAULT_EVENT_ID`;
- legacy `Solve.event` is dropped;
- legacy `Settings.event` is dropped;
- missing solve moves become an empty move list;
- obsolete analysis shapes are discarded so they can be rebuilt where possible.

This normalization is intentionally one-way toward the current ownership model.

## Backup and interchange boundaries

There are two distinct interchange formats.

### JSON backup

The Controller's JSON export currently writes:

```text
format: cubetimer
version: 2
```

Event identity exists on Sessions in the exported model.

The JSON import path normalizes legacy Session/Solve shapes through the current persistence migrations before saving them.

Import preserves stable IDs, so re-importing the same records updates rather than inherently creating new identities.

### Solve-analysis CSV

`src/state/solveCsv.ts` owns the solve-analysis CSV compatibility boundary.

The CSV format has no event field.

Sessions created from CSV imports therefore receive `DEFAULT_EVENT_ID`.

The CSV contract should not be changed casually as a side effect of internal persistence refactoring.

## Settings

`Settings` contains user preferences, not session identity or event ownership.

Examples include:

- Slow Solve;
- inspection behavior;
- timer interaction;
- visualization;
- cross/front colour preferences;
- gyroscope use;
- sound;
- theme;
- XCross/cross generation preferences.

Session/event concerns must not be pushed back into `Settings` as a second source of truth.

## Statistics

Normal statistics are calculated from the selected Session's loaded solves.

Slow/practice solves are excluded from ordinary counted statistics.

Rolling averages, projected long averages, bests, means, CFOP summaries, and related calculations live under `src/state/stats.ts`.

Solve-result comparison uses prior compatible solves from the same `sessionId`, rather than attempting to recover event compatibility from a duplicated field on each Solve.

## React UI

Components under `src/components/` present Controller/domain state and initiate Controller actions.

Important surfaces include:

- session/event controls;
- smart-cube connection;
- scramble guidance;
- timer;
- cube visualization;
- solve history;
- statistics;
- solve results;
- replay;
- analysis tools;
- Slow Solve coaching;
- F2L Training;
- settings.

Presentation components may derive display-specific values from their inputs.

They must not introduce competing persistent sources of truth.

## External and browser boundaries

### React / React DOM

Own UI rendering and interaction.

React does not own the core application state machine.

### cubing.js

Provides cube/puzzle state, algorithms, scrambling and related cube functionality.

### gan-web-bluetooth

Provides supported smart-cube protocol integration.

It is isolated behind `SmartCube` rather than used directly throughout the application.

### RxJS

Used by the Bluetooth integration for the hardware event stream.

### Browser APIs

The application runs locally in the browser and currently has no application backend service.

Material browser boundaries include:

- Web Bluetooth;
- IndexedDB;
- `localStorage`;
- animation timing;
- browser rendering.

Remembered Bluetooth MAC addresses are stored separately in `localStorage`, not in the IndexedDB application records.

## Durable invariants

The following are current architectural rules.

1. **The Controller owns cross-cutting runtime orchestration.**  
   Do not reproduce its timer, session, training, hardware, or solve state machines inside React components.

2. **A Session is the single source of truth for `EventId`.**  
   `Solve` and `Settings` must not duplicate active event ownership.

3. **A historical Session retains the event under which its solves were recorded.**  
   Changing event after history exists creates a new Session rather than relabelling the old history.

4. **Session/event context cannot change during inspection or an active solve.**

5. **`src/cube` does not depend on `src/state`.**  
   Domain functions receive narrow structural inputs instead of importing persistence records.

6. **The persisted `Solve` record remains owned by `src/state`.**  
   Do not move persistence/session/interchange metadata into the cube domain for convenience.

7. **`SmartCube` owns hardware transport, not application policy.**

8. **The normal `CubeModel` represents the physical or normal keyboard-driven cube.**  
   Training targets and virtual F2L state must not replace it.

9. **Timer and F2L Training live state remain isolated.**  
   Training attempts must not leak into ordinary solve history or statistics.

10. **Persistent application records flow through the state/persistence layer.**  
    Components must not become direct IndexedDB owners.

11. **Raw solve facts and derived analysis remain distinguishable.**  
    Analysis may be repaired or rebuilt from retained facts where supported.

12. **Narrow stores and Controller events are preferred for high-frequency runtime updates.**

13. **Generated case, algorithm, and thumbnail data is not a general architectural abstraction or discovery starting point.**

## Rejected alternatives

These alternatives are recorded because the current architecture deliberately chose a different ownership model.

### Event duplication

Rejected:

```text
Store EventId on Session, Solve, and Settings and keep the values synchronized.
```

Reason:

```text
That creates multiple sources of truth and allows session history, statistics,
scramble generation, and recorded solves to disagree about the event.
```

`Session.event` is the canonical source instead.

### Relabelling historical Sessions

Rejected:

```text
When the user changes event, mutate the selected Session even if it already
contains solves.
```

Reason:

```text
That would change the meaning of existing history. Once a Session has solves,
changing event creates a new Session instead.
```

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

Virtual F2L Training keeps separate ephemeral state instead.