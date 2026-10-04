# Sessions, history and persistence boundaries

These documents describe current state. Start at [SYSTEM.md](SYSTEM.md); load only the sources relevant to the requested change. Matching tests sit beside their owner.

## Agent loading

| Task | First sources |
| --- | --- |
| Session/EventId rules and transitions | `src/features/sessions/sessionService.ts`, `src/app/types.ts`; runtime queue/lock in `src/app/Controller.ts` |
| Stored Solve history, repair or snapshots | `src/features/history/solveHistory.ts`, `repair.ts` |
| Completed Training history and normalization | `src/features/training/trainingHistory.ts`, `src/app/types.ts`, `src/infrastructure/persistence/db.ts` |
| IndexedDB CRUD/migration | `src/infrastructure/persistence/db.ts` and its tests |
| Settings | `src/app/types.ts`, `settings.ts`, Controller persistence |
| JSON backup/import | `src/features/data-transfer/dataTransfer.ts`, Session merge rules in `sessionService.ts` |
| CSV contract | `src/features/data-transfer/solveCsv.ts`, `csv.ts`, transfer tests |
| Statistics scope/averages/projections | `src/features/statistics/state/stats.ts`, `statistics.ts`; `src/features/statistics/components/StatisticsView.tsx`, `StatisticsCharts.tsx` |
| Solve/replay/result presentation | `src/features/history/components/SolveResult.tsx`, `StepBreakdown.tsx`, `ReplayDialog.tsx`, `replayTimeline.ts`, `replayFocus.ts` |
| Persisted Solve scramble-provider encoding/display labels | `src/app/scrambleProvider.ts` |

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
schema version: 2

stores:
  sessions
  solves
  settings
  trainingAttempts
```

The v1-to-v2 upgrade adds `trainingAttempts` with key path `id` without replacing
Sessions, Solves or Settings. No speculative Training indexes are needed; startup
loads all attempts in timestamp-then-ID order. Stable-ID `put()` upserts are
idempotent, and Training writes wait for transaction completion.

### Persisted records

`src/app/types.ts` defines the current:

- `Session`;
- `Solve`;
- `TrainingAttempt`;
- `Settings`.

Components do not write IndexedDB directly.

`src/app/scrambleProvider.ts` owns the encoding and display labels for persisted
`Solve.scrambleProvider` metadata shared by Timer production and history/result
presentation. Provider strings retain their interchange meaning independently of
the feature that produces them. Generic time formatting belongs to `src/shared/time.ts`;
Statistics calculations remain in the Statistics feature.

Persisted application workflows flow through concrete state services:

```text
React
  |
  v
Controller public API
  |
  +--> SessionService / SolveHistory / TrainingHistory / DataTransfer
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

### Training history

```text
TrainingRuntime completion -> Controller -> TrainingHistory -> db.ts
-> IndexedDB trainingAttempts
```

Live Training state remains ephemeral. Completed attempts are independent global
application records, with UUID, timestamp, setup/virtual mode, discriminated target,
Single/Drill activity, actual moves and measured performance. `elapsedMs` is the
registered first-to-last move span. Drill records also carry reveal-to-completion
`caseTimeMs`; Single records carry null. They carry no Session/Event ownership and
never enter normal Solve/Statistics collections. Controller owns a separate
Training-attempt Store and appends immediately before asynchronous persistence;
errors leave the completed result intact. TrainingRuntime and React do not access
IndexedDB. Catalogue performance is derived in the Training feature, not stored in
Settings or Statistics. Exact solve-step facts persist but do not affect catalogue
mastery; their source Solve need not still exist.

`normalizeTrainingAttempt` validates only the current shape: ID, timestamp, mode,
discriminated target/catalogue combinations, result numbers and move array. It
rebuilds the contract explicitly and skips malformed records on load/import. Missing
additive activity/case-time fields in older records normalize to
Single/null without discarding history. The store shape is unchanged and IndexedDB
remains schema version 2.

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
version: 4
```

Event identity exists on Sessions in the exported model.
Full v4 backups contain `sessions`, `solves` and global `trainingAttempts`, including
activity and case time. Version-3 attempts without those fields import as Single/null.
Older v2 archives without Training history still import as an empty incoming attempt list,
preserving existing local Training history. Current records normalize before
stable-ID upsert; repeated import does not duplicate IDs. Training attempts do not
participate in Session event compatibility checks or require a source Solve in the
archive. JSON import counts include attempts and Controller refreshes its history
Store after success. CSV remains Solve-only and its contract is unchanged.

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

### Training mastery in Settings or Timer Session/Solve records

Rejected because Settings stores preferences, whereas attempts are historical user
activity. Training lifecycle/meaning differs from Timer solves and cannot feed
normal solve statistics. Catalogue identity is global and independent of Timer
Session/Event ownership, so Session changes must not reset mastery.

### TrainingRuntime writes IndexedDB or exact practice silently updates mastery

Runtime persistence would conflate live orchestration with persisted workflows.
Exact historical targets preserve solve-specific state and F2L targets may not
identify any selected catalogue/library. Keep the completion workflow behind
Controller and include only catalogue-origin attempts in mastery/review derivation.

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
