# Application and physical/Timer runtimes

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Composition, area routing or Session/runtime integration | `src/app/Controller.ts`, `src/app/Controller.test.ts` |
| Physical model, device events, grip or synchronization | `src/app/PhysicalCubeRuntime.ts`; transport in `src/infrastructure/bluetooth/smartCube.ts` |
| Timer, inspection, scrambles, solve facts or analysis orchestration | `src/features/timer/TimerRuntime.ts` |
| Persisted scramble-provider encoding/display labels | `src/app/scrambleProvider.ts` |
| Generic millisecond/time formatting | `src/shared/time.ts` |
| React subscriptions/navigation | `src/app/App.tsx`, `useController.ts`, the relevant feature/shared component |
| Cross/XCross/Slow Solve | `src/cube/crossSolver.ts`, `crossPlans.ts`, `crossScramble.ts`; `src/features/timer/components/CoachPanel.tsx` |

For target/Training lifecycle load [TRAINING.md](TRAINING.md). For frame/grip domain rules load [CUBE.md](CUBE.md). For persisted transitions/serialization load [PERSISTENCE.md](PERSISTENCE.md).

## Runtime ownership

`src/main.tsx` creates one long-lived `Controller`, calls `controller.init()`, and exposes it to React through `ControllerContext`.

Controller composes one long-lived PhysicalCubeRuntime, TimerRuntime and
TrainingRuntime. It owns application-area routing, Session/runtime integration,
Settings persistence, public UI facades, and the shared elapsed RAF scheduler.

PhysicalCubeRuntime owns physical/device/grip facts: the single physical CubeModel,
SmartCube handlers, hardware/battery state, facelet synchronization, gyro readings,
LiveGrip and recentre listeners. It publishes each physical move after updating the
model; Controller routes it to the active runtime. Synthetic turns enter the same
path through `Controller.injectMove()`.

TimerRuntime owns the Timer/solve lifecycle: phase, scramble tracker and generation,
inspection, elapsed timestamp, recovery cancellation, raw moves/readings, starting
pattern, penalty/source, Solve construction and analysis. Controller supplies active
Session/EventId, Settings and a SolveHistory persistence callback. TimerRuntime does
not own Session persistence. TrainingRuntime remains the sibling Training owner.

Feature runtimes consume narrow structural physical-cube contracts. Controller
passes PhysicalCubeRuntime into those contracts; feature runtimes do not import
concrete application runtime classes.

This logic lives outside React intentionally. Cube events may arrive frequently and timing updates every animation frame.

Controller owns runtime consequences. Services own persisted application workflows
and return explicit results without mutating `AppState`. For example,
`sessionService.ts` reports that the selected Session changed from event 333 to 222;
Controller invalidates the current scramble context and generates a 222 scramble.
The service does not depend on Timer/Training phases, scramble tracking, or live
cube state.

### Observable state

`src/shared/store.ts` provides the small observable `Store<T>` abstraction.

Observable stores follow ownership:

| Store | Owner and content |
| --- | --- |
| `Controller.state` | Ready, application area and global error |
| `Controller.sessions` | Sessions, selected id, active history and last Solve |
| `Controller.settings` | Settings, including OLL/PLL training-set preferences |
| `physical.state` | Device status, hardware, battery and physical facelets |
| `timer.state` | Timer phase, scramble/progress/generation, recovery, live moves, source and penalty |
| `training.state` | Training lifecycle only |
| `Controller.trainingDrillPresets` | Global persisted named Drill configurations, separate from runtime, Settings and Sessions |
| `Controller.trainingDrillPresetApplying` | Narrow application busy fact; blocks Drill Start during atomic preset loading |
| `Controller.trainingAlgorithmPreferences` | Global user-owned catalogue algorithm preferences, independent of Sessions/Settings/runtime |
| `Controller.trainingRecognitionAttempts` | Global persisted Recognition answers, separate from Execution and runtime |
| `Controller.trainingAttempts` | Global persisted completed Training facts, separate from live Training and Timer history |
| `training.drillCountdown` | Remaining Drill countdown milliseconds; narrow RAF-frequency presentation only |
| `Controller.elapsed`, `inspectionLeft` | Shared elapsed publication and Timer inspection remaining |

`AppState` contains neither Timer nor Training nor physical cube state. There is no
observable aggregate mirror. `Controller.snapshot()` composes a read-only value for
synchronous actions; it does not publish or store a second copy. React subscribes
through ownership hooks. Timer/cube high-frequency subscriptions live below App
navigation; Header selects stable phase/device facts. Training subscribes directly
to TrainingRuntime. Presentation-only selection/dialog/hold state remains React-owned.

Saved presets reach TrainingRuntime only as hydrated context, selected cases, task and
strategy through a narrow configuration seam. Runtime owns no persistence or saved
identity. Controller persists prospective OLL/PLL Settings before publishing/hydrating and
refuses loads in running/summary state. Start remains explicit; RAF ownership and
lifecycle are unchanged.

TrainingRuntime receives only a narrow preference lookup and resolves a target-specific
preferred executable reference, separate from canonical references. It owns neither
persistence nor preference record metadata. Refresh updates guidance/reference facts
without replacing the target; solving freezes the benchmark and completed results
remain snapshots. No RAF or runtime lifecycle changes are needed.

High-frequency physical and Timer stores are subscribed at the smallest feature
surface that consumes them. Navigation, history, statistics summaries, and case
libraries must not receive physical move updates through aggregate snapshots.
Connection controls select device facts; scramble, coach, Timer display and cube
surfaces subscribe locally. Training navigation selects its family, libraries select
case preferences/targets, and setup/cube/attempt surfaces own their live subscriptions.
Selectors return primitive values or stable references contained in their store.

One Controller RAF scheduler calls `TimerRuntime.tick(now)` or
`TrainingRuntime.tick(now)` for the active area. Training tick owns live elapsed
publication and initial/inter-round Drill countdown progression/expiry. The narrow
`drillCountdown` Store keeps RAF updates out of aggregate TrainingState and case
libraries; React only presents the remaining milliseconds. There is no React timer
or second RAF. The runtimes own their timestamps and request shared
clock start/stop through injected callbacks. Training tick continues only while an
attempt is solving or a Drill countdown has a deadline. Revealed ready Drill cases
stop RAF until the first move starts the clock again. The separately retained reveal
timestamp preserves full case timing through this recognition wait. Timer and Training own independent
recovery cancellation tokens and share the pure `calculateRecovery()` solver path.

`src/app/useController.ts` connects stores to React through `useSyncExternalStore`.

The Controller also exposes targeted listener seams for events such as:

- cube moves;
- grip changes;
- full pattern replacement;
- view recentering;
- completed solve recording.

High-frequency or narrowly scoped events should not require unrelated application-wide React updates.

### React responsibility

`src/app/App.tsx` owns presentation-level state such as:

- which result is open;
- selected historical solve;
- replay dialog state;
- analysis dialog state;
- temporary return context when entering Training from a result or replay.

That state controls presentation and navigation.

It must not duplicate Controller runtime state machines or the persisted workflows
owned by the state application services.

## Smart-cube data flow

`src/infrastructure/bluetooth/smartCube.ts` is the hardware adapter around `gan-web-bluetooth`.

The normal hardware path is:

```text
GAN cube
-> gan-web-bluetooth
-> SmartCube
-> PhysicalCubeRuntime
-> single physical CubeModel
-> Controller input routing
-> TimerRuntime / analysis or, when Training is active, TrainingRuntime
-> Training Store (TrainingRuntime.state) / other stores and narrow events
-> React Training UI / other presentation
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

## Virtual and injected input

`Controller.injectMove()` delegates to the same PhysicalCubeRuntime move-processing seam used by smart-cube moves.

This is used by virtual cube interaction and provides tests with a way to exercise the normal runtime path without a separate implementation.

Avoid creating parallel move-processing pipelines when the existing injection seam is sufficient.

## Application areas and Training isolation

The Controller owns three top-level application areas:

```text
timer
training
statistics
```

Timer and Training own live workflows. Statistics is a read-only/non-timing area
for historical analytics. It gates live Timer/Training input while visible but
does not create a third solve or training state machine. The Controller refuses
to enter Statistics while Timer inspection/solving, a Single solving attempt, or
any running Drill phase (including countdown and ready) is active.
Entering Statistics remembers the prior runtime area without resetting idle Single
state; finished Drill outcomes/summary are discarded through the Training leave
boundary while pool/strategy remain configured. Returning reconciles progress
against the physical cube.

Within Training, one shared lifecycle serves these families:

```text
training
  f2l
  oll
  pll
```

Switching areas resets or cancels incompatible live state.

Training turns must not enter the normal timer lifecycle or ordinary solve history.

## React UI

Components under feature directories, `src/app/components/` and `src/shared/ui/`
present runtime/domain state and initiate Controller actions.

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
- Training (F2L, OLL, and PLL);
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

## Rejected alternatives

### Aggregate observable feature snapshots

Rejected because an aggregate Timer or Training snapshot reconnects unrelated
presentation to physical/runtime updates and recreates the rerender fan-out that
ownership stores are intended to remove. Compose synchronous action snapshots
only; presentation subscribes to the facts consumed by each surface.

### One CubeModel per feature

Timer and Training observe the same physical cube. Competing physical models would
allow input, synchronization and grip facts to drift. PhysicalCubeRuntime owns
one model; virtual Training keeps only its separate ephemeral target pattern.

These alternatives are recorded because the current architecture deliberately chose a different ownership model.

### React-only Statistics overlay

Rejected:

```text
Show Statistics as an overlay while the Controller remains in Timer or Training.
```

Reason:

```text
Cube events could start or progress hidden timed activity. Statistics is an explicit non-timing Controller area instead.
```

## Recognition and smart catalogue runtime policy

One TrainingRuntime owns Execution/Recognition Drill task, generated concrete target,
answer options, publication timestamp, ephemeral outcomes and summary. Preparation
publishes target/options together after domain reference preparation; answer timing
uses that timestamp with no RAF while waiting. Recognition ignores cube turns before
virtual mutation. Runtime emits a separate Recognition completion fact containing
run ID/actual round/catalogue target/answer/response time. Each explicit Start creates
one fresh injected run ID; Execution completion carries the same run context.

Controller owns Recognition Store publication and TrainingRecognitionHistory
persistence. Both histories enter `#pendingTrainingWrites`; backups/imports await it
and `#trainingConfigurationMutationQueue`. Preset application remains persist-first,
busy through publication, Start blocked, hydrating context/pool/strategy/task atomically.

Runtime's injected RNG chooses cases, AUF, underlying variants and textual choices.
Family cube builders own target construction/validation. Last variation per durable
catalogue key is ephemeral and never enters history or preferences. Exact historical
practice never randomizes. Personal source preferences resolve each generated target
through the existing injected lookup and family resolver. No additional state machine,
physical CubeModel, preference Store or persistence owner exists.
