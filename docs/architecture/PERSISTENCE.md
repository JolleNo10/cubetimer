# Sessions, history and persistence boundaries

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Session/EventId rules and transitions | `src/features/sessions/sessionService.ts`, `src/app/types.ts`; runtime queue/lock in `src/app/Controller.ts` |
| Stored Solve history, repair or snapshots | `src/features/history/solveHistory.ts`, `repair.ts` |
| IndexedDB CRUD/migration | `src/infrastructure/persistence/db.ts` and its tests |
| Settings | `src/app/types.ts`, `settings.ts`, Controller persistence |
| JSON backup/import | `src/features/data-transfer/dataTransfer.ts`, Session merge rules in `sessionService.ts` |
| CSV contract | `src/features/data-transfer/solveCsv.ts`, `csv.ts`, transfer tests |
| Statistics scope/averages/projections | `src/features/statistics/state/stats.ts`, `statistics.ts`; `src/features/statistics/components/StatisticsView.tsx`, `StatisticsCharts.tsx` |
| Solve/replay/result presentation | `src/features/history/components/SolveResult.tsx`, `StepBreakdown.tsx`, `ReplayDialog.tsx`, `replayTimeline.ts`, `replayFocus.ts` |

Load [RUNTIME.md](RUNTIME.md) for live context integration, [TRAINING.md](TRAINING.md) for historical practice, or [CUBE.md](CUBE.md) for derived analysis/frame meaning.

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

`sessionService.ts` owns this persisted rule and returns the selected Session,
Session list, Solve history, and whether the event changed. It also owns initial
Session creation, event inheritance, selection/history resolution, renaming,
deletion fallback, and import merge compatibility. Controller applies the result
and its runtime consequences under the Session-context lock.

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

Session/event context cannot change during:

- Timer `inspection`;
- Timer `solving`;
- a Training `solving` attempt.

The Controller enforces this rule; the UI also disables the corresponding controls.

This prevents a running solve from changing the context under which it is being recorded.

The Controller's Session-context lock spans the complete asynchronous persistence and
state-refresh operation, and prevents a timer start or overlapping Session operation
until it completes.

### Session persistence serialization

Controller serializes persisted Session mutations. Context-changing Session
operations additionally hold the Session-context runtime lock; metadata-only
rename participates in persistence serialization without becoming a Timer/Training
context transition.

| Boundary | Operations | Purpose |
| --- | --- | --- |
| Session persistence queue | select, create, change event, delete, rename, JSON import, CSV import | Prevent concurrent full-record Session writes and stale context application |
| Session runtime-context lock | select, create, change event, delete, JSON import, CSV import | Protect Timer/Training context, Session identity, EventId, and scramble semantics |

Context-changing requests acquire the runtime lock before waiting for the queue,
so Timer start stays blocked even when the request is waiting behind rename.
Each queued operation reads the latest context when it executes and includes both
persistence and Controller application, through history reload and scramble
consequences. A rejected operation does not poison subsequent queued work.
Rename alone remains available during active timing and does not invalidate the
scramble or replace the active history.

### Switching Sessions

Selecting another Session loads that Session's solves.

SessionService resolves the transition through SolveHistory, which loads and
repairs persisted history. The Controller applies it to active application state.

If the target Session has a different event, the Controller invalidates the old scramble context and generates a scramble for the newly selected event.

Statistics shown in the normal application are therefore naturally scoped to the selected Session because the Controller's active `solves` collection contains that Session's history.

Solve-to-history comparisons additionally require matching `sessionId`.

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
-> SolveHistory persistence
-> db.ts / IndexedDB
-> Controller Session Store
-> result / history / statistics UI
```

Presentation components do not independently own or persist canonical solves.

## Persistence

`src/infrastructure/persistence/db.ts` owns IndexedDB access.

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

`src/app/types.ts` defines the current:

- `Session`;
- `Solve`;
- `Settings`.

Components do not write IndexedDB directly.

Persisted application workflows flow through concrete state services:

```text
React
  |
  v
Controller public API
  |
  +--> SessionService / SolveHistory / DataTransfer
          |
          v
        db.ts
          |
          v
       IndexedDB
```

Controller retains Settings persistence in this phase. `db.ts` owns low-level
storage and migration, rather than Session event-change policy, active selection,
import compatibility, or runtime permission to change context.

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

`dataTransfer.ts` owns JSON export/import; Controller exposes the public facade.
The export writes:

```text
format: cubetimer
version: 2
```

Event identity exists on Sessions in the exported model.

The JSON import path normalizes legacy Session/Solve shapes through the current persistence migrations before saving them.

Import preserves stable IDs, so re-importing the same records updates rather than inherently creating new identities.

### Solve-analysis CSV

`src/features/data-transfer/solveCsv.ts` owns the solve-analysis CSV compatibility boundary.

The CSV format has no event field.

Sessions created from CSV imports therefore receive `DEFAULT_EVENT_ID`.

`dataTransfer.ts` owns CSV import/export orchestration, including stable-ID
upserts, batched writes, progress callbacks, and browser yields between batches.
Both JSON and CSV workflows validate Session merge compatibility through
`sessionService.ts` before any writes. After importing, SessionService reloads
the persisted context, retaining the selected Session when available and using
the newest Session as fallback. Controller applies the result, reconciles
same-event scramble progress, or invalidates incompatible scramble/recovery state
and regenerates for a changed event. Its runtime lock spans the entire operation.

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

The compact Timer `StatsPanel` remains calculated from the selected Session's loaded
solves. The full Statistics area receives a Controller-provided all-history snapshot;
React does not read IndexedDB directly. `Controller.sessions.solves` remains the active Session's
history. The facade delegates snapshot loading and repair to `solveHistory.ts`.

The full view has independent event and Session filters. Event compatibility is
resolved through `Solve.sessionId -> Session.event`; `All sessions` means all Sessions
for one event and never combines different events. Selecting a Statistics Session is a
view filter and does not change the active Timer Session or event.

Slow/practice/replay solves are excluded from ordinary counted statistics.

`src/features/statistics/state/stats.ts` owns the low-level WCA average trimming/DNF rules,
selected-Session long-average projections, and independent solve/CFOP summaries.

`src/features/statistics/state/statistics.ts` combines these low-level rules with Statistics scope.
Cross-Session Statistics may aggregate Singles and other independent solve facts for
Sessions of the same Event, but rolling averages are Session-local. An
Ao5/Ao12/Ao50/Ao100 window must never span Session boundaries. All-Sessions average
rankings/history merge achieved Session-local windows rather than flattening Sessions
into one average sequence. Overview shows the latest achieved window and its source
Session; long-average projections remain limited to a selected Session.

Overview, Solves, CFOP, and Cases navigation is local React presentation state.
Chart windows affect visible charts only, not rankings or summaries.

Solve-result comparison uses prior compatible solves from the same `sessionId`, rather than attempting to recover event compatibility from a duplicated field on each Solve.

## Rejected alternatives

### Merge/reconcile stale Session snapshots after concurrent writes

Rejected because `db.saveSession()` writes complete Session records with IndexedDB
`put()`. Re-applying old in-memory snapshots cannot reliably prevent one persisted
full-record write from overwriting another field. Serialization is the authoritative
concurrency boundary; object identity is not part of the Session transition contract.

### Moving the Session-context lock and scramble consequences into SessionService

Rejected because it would couple a persistence-oriented Session service to Timer
phases, Training attempts, scramble tracking, and live cube runtime. SessionService
determines persisted Session transitions; Controller owns whether a live transition
is currently allowed and what runtime state must be invalidated afterward.

### One generic persistence/application service

Replacing Controller's persisted workflows with one large generic service would
reproduce its responsibility concentration under a new name. SessionService,
SolveHistory, and DataTransfer remain concrete boundaries with distinct invariants;
there is no generic repository framework.

### Flattening Sessions into rolling averages

Flattening all same-Event solves into one rolling-average sequence was rejected
because it creates averages that were never achieved within any actual Session and
makes PB/current-average semantics misleading. Statistics instead merges achieved
Session-local windows for average rankings and history.

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

### Blindly overwriting Session events during import

Rejected:

```text
Blindly overwrite Session.event during an id-based import merge.
```

Reason:

```text
It can reinterpret existing solves and bypass the same immutable-history rule
enforced by normal event changes.
```

### React reading IndexedDB directly

Rejected:

```text
Have StatisticsView load IndexedDB history directly.
```

Reason:

```text
Persistence workflows remain behind the Controller public API and state application services. A direct React path would create a second data-access route and could skip solve-analysis repair.
```

### Flattening every Solve across every event

Rejected:

```text
Treat All sessions as one population regardless of EventId.
```

Reason:

```text
Solve deliberately has no EventId, and times/averages from different events are not one meaningful population. Event must be resolved through Solve.sessionId -> Session.event.
```
