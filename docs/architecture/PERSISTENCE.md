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
| Solve/replay/result presentation | `src/features/history/components/SolveResult.tsx`, `StepBreakdown.tsx`, `resultCharts/`, `SolveReviewDialog.tsx`, `SolveReviewPanel.tsx`, `replayTimeline.ts`, `replayFocus.ts` |
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

Solve-to-history comparisons on the result screen follow the Session's
`compareScope`: `"session"` (the default, also used when the field is missing)
compares with earlier solves of the same `sessionId`; `"event"` compares with
earlier solves from every Session of the same event. The scope is a property of
the Session, chosen per Session from the result screen, not a global Setting.

## Solve data flow

For a native smart-cube solve, the important factual inputs are:

```text
scramble / starting cube state
+ timed move stream
+ available grip/orientation information
+ optional independent solveStartBottomFace observation
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

`Solve.solveStartBottomFace` retains the physical bottom face observed at solve start,
when available. `migrateSolve` preserves valid cube faces and drops invalid imported
values. Whole-record Solve persistence and JSON v7 backup retain this additive raw fact;
IndexedDB stays schema 5 and JSON remains version 7. Solve-analysis CSV stays unchanged
and has no independent start-orientation column. Historical grip tracks and Cross colour
preferences must not manufacture this observation.

Nested `SolveAnalysis.analysisVersion` and derived quality govern reconstruction and
CFOP trust; they are distinct from top-level interchange `Solve.analysisVersion`.
Rebuildable legacy analyses gain current quality from raw facts. Unrebuildable legacy
and suspect breakdowns remain displayable, but only explicitly current trusted quality
enters CFOP analytics, comparisons or step-specific training. Ordinary timing eligibility
and statistics-outlier handling remain independent of CFOP quality.


`Solve.cfopAnalysisExcluded?: true` is durable user-authored metadata: a reversible
veto of the CFOP interpretation, separate from derived `SolveAnalysis.quality`.
Rebuilds replace only analysis and retain this judgement. It can exclude, never force
an automatically suspect interpretation into use. `isUsableCfopAnalysis(solve)` combines
machine trust with this veto for analytics, comparisons, training, Tools and Replay's
inferred-frame fallback. Normal solve timing/count/average/PB eligibility is unaffected.
Result/History editing uses Controller and SolveHistory persistence; components do not
write IndexedDB directly. Normal counted SmartCube rows show `CFOP excluded` before
machine status; Slow Solve/Replay/practice keep their existing compact badges.

Migration keeps only literal `true`, dropping other imported values. Whole-record
IndexedDB persistence and JSON v7 preserve the field without a schema/format version
bump (DB remains 5). CSV remains unchanged and does not carry the local veto.
Rejected: storing the manual decision in `SolveAnalysis.quality`. Analysis is derived
and rebuildable; user judgement must survive re-analysis and stay distinguishable from
analyser output.


## Unusually slow normal solves

Settings owns a multiplier (default 3) and handling (default exclude; Off or DNF
are alternatives). A pure Statistics projection processes raw history in timestamp
then ID order, separately per Session. It compares a normal finished solve's
penalty-adjusted time with the median of the previous up-to-20 positive finite
counted finished times, requiring at least five. Only times strictly above the
threshold are flagged; flagged solves never enter later baselines.

The projection covers existing and future history and recomputes when settings
change. It supplies ephemeral `statisticsOutlier` metadata to session presentation,
Statistics and result comparisons. Exclusion uses the shared counted eligibility
rule; DNF uses the shared effective-time rule and ordinary DNF average semantics.
Raw times, manual penalties, analysis and history remain intact. Persistence strips
the derived annotation; exports retain raw facts. Destructive rewriting of slow-mode
flags or manual penalties is rejected because changing policy must be reversible.

## Persistence

`src/infrastructure/persistence/db.ts` owns IndexedDB access.

The current database is:

```text
name: cubetimer
schema version: 5

stores:
  sessions
  solves
  settings
  trainingAttempts
  trainingDrillPresets
  trainingAlgorithmPreferences
  trainingRecognitionAttempts
```

The v1-to-v2 upgrade adds `trainingAttempts` with key path `id` without replacing
Sessions, Solves or Settings. No speculative Training indexes are needed; startup
loads all attempts in timestamp-then-ID order. Stable-ID `put()` upserts are
idempotent, and Training writes wait for transaction completion. The v2-to-v3
upgrade adds only `trainingDrillPresets` with key path `id`; all four existing
stores and their records survive. The v3-to-v4 upgrade adds only
`trainingAlgorithmPreferences` with key path `key`, preserving all five old stores. The v4-to-v5 upgrade adds only
`trainingRecognitionAttempts` with key path `id`, preserving all six existing stores.

### Persisted records

`src/app/types.ts` defines the current:

- `Session`;
- `Solve`;
- `TrainingAttempt`;
- `TrainingDrillPreset`;
- `TrainingAlgorithmPreference`;
- `TrainingRecognitionAttempt`;
- `Settings`.

Components do not write IndexedDB directly.

`src/app/scrambleProvider.ts` owns the encoding and display labels for persisted
`Solve.scrambleProvider` metadata shared by Timer production and history/result
presentation. Provider strings retain their interchange meaning independently of
the feature that produces them.

Calendar timestamps are stored as UTC Unix epoch milliseconds; CSV timestamps
remain standardized UTC text. Date/clock formats and the IANA display time zone
(empty for browser autodetection) are Settings-owned presentation preferences.
Time zone conversion occurs only when displaying timestamps, preserving stored
instants, chronological sorting and elapsed durations. Storing localized calendar
strings is rejected because time zone and daylight-saving changes would make them
ambiguous. Generic time formatting belongs to `src/shared/time.ts`;
Statistics calculations remain in the Statistics feature.

Persisted application workflows flow through concrete state services:

```text
React
  |
  v
Controller public API
  |
  +--> SessionService / SolveHistory / TrainingHistory / TrainingRecognitionHistory
  |    / TrainingDrillPresets / TrainingAlgorithmPreferences / DataTransfer
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
Curriculum stages, due state, active learning cohorts, adaptive recommendations and
Guided plans are derived from Execution/Recognition history and catalogue metadata,
never persisted. IndexedDB remains schema 5 and JSON backup remains version 7.

`normalizeTrainingAttempt` validates only the current shape: ID, timestamp, mode,
discriminated target/catalogue combinations, result numbers and move array. It
rebuilds the contract explicitly and skips malformed records on load/import. Missing
additive activity/case-time fields in older records normalize to
Single/null without discarding history. Missing preferredStm/matchedPreferred/
preferredDelta normalize to null. Current personal benchmark combinations must be
all null or a finite nonnegative STM, boolean match and finite delta; partial
combinations are rejected. Completed benchmark facts never change with later preferences.

### Recognition history and Drill run metadata

React -> Controller -> TrainingRecognitionHistory -> db.ts -> IndexedDB
trainingRecognitionAttempts. Runtime emits a completion fact; Controller constructs
UUID/timestamp, immediately appends to its independent Store, then persists. Failure
retains the visible answer/result and reports globally. Both historical workflows
participate in `#pendingTrainingWrites`; export/import await these writes and the
separate Training configuration mutation queue.

Recognition records contain run ID, positive safe-integer revealed round, normalized
TrainingCatalogueIdentity, answer case ID in exactly that catalogue context and finite
nonnegative response time. Correctness is derived, not stored. Unknown fields drop;
malformed rows skip; loads order by createdAt then ID and writes await transaction
completion. Recognition history has no Session/Event, source Solve, preset or personal
algorithm ownership.

TrainingAttempt adds nullable `drillRunId`/`drillRound`: Single null/null, new Execution
Drill nonempty ID/positive integer, legacy (including old Drill) null/null. Partial
pairs reject; personal benchmark normalization is unchanged. No persistent run object
or skip record exists. Preset task defaults to Execution when absent; unknown task
rejects; Recognition requires two distinct selected cases, Execution one.

JSON v7 includes Recognition; older versions contribute an empty incoming list and
never erase local Recognition history. Recognition stable-ID upserts are independent
of Session compatibility. Old run metadata/preset task normalize as above. Existing
personal-algorithm semantic import validation and deterministic-key upserts remain.
CSV remains Solve-only.

### Saved Drill configuration

```text
React -> Controller -> TrainingDrillPresets workflow -> db.ts
-> IndexedDB trainingDrillPresets
```

TrainingAttempt is a historical completed practice fact. TrainingDrillPreset is
user-authored reusable configuration. Neither is a Timer Session. Presets are global
records with stable UUIDs, names (duplicates allowed), createdAt/updatedAt,
discriminated catalogue context, selected cases and strategy. They contain no live
run state, targets, outcomes, or summaries and are not a Settings collection.

`normalizeTrainingDrillPreset` validates/rebuilds the current shape, including valid
context and every supplied case ID. Unknown cases reject the entire preset. Valid
duplicates collapse and cases normalize into catalogue order. Empty presets are
invalid. Load/import skip malformed rows; save rejects invalid records. Loads order
by updatedAt descending, then ID. Stable-ID put and delete await transaction completion.
Controller serializes explicit edits and publishes only after successful persistence;
loading/using a preset does not change modification time.

### Personal algorithm configuration

```text
React -> Controller -> TrainingAlgorithmPreferences workflow -> db.ts
-> IndexedDB trainingAlgorithmPreferences
```

`TrainingAttempt` is a historical completed practice fact. `TrainingDrillPreset`
is reusable case/strategy/task configuration. `TrainingAlgorithmPreference` is a user
algorithm choice for one catalogue identity. Settings remains application preferences.
None of these Training records is a Timer Session.

Preference key equals the shared JSON catalogue tuple, verified against the target.
F2L includes library/case/position; last layer includes family/set/case, not AUF.
Record normalization validates catalogue, stable algorithm text, source, optional
note and timestamps. Cube solving semantics belong to Training/cube, not IndexedDB.
Save/delete await transaction completion. Explicit configuration edits share the
Controller Training configuration mutation queue and publish only after persistence.

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
version: 7
```

Event identity exists on Sessions in the exported model.
Full v7 backups contain `sessions`, `solves`, global `trainingAttempts` and
`trainingDrillPresets`, `trainingAlgorithmPreferences` and `trainingRecognitionAttempts`. Training attempts include
activity and case time. Version-3 attempts without those fields import as Single/null.
Older v2 archives without Training history still import as an empty incoming attempt list,
preserving existing local Training history. Current records normalize before
stable-ID upsert; repeated import does not duplicate IDs. Training attempts do not
participate in Session event compatibility checks or require a source Solve in the
archive. v4/v3/v2 archives without presets contribute an empty incoming list,
preserving existing saved drills. Presets normalize and stable-ID upsert independently
of Session/Solve compatibility and TrainingAttempt source-Solve checks. Same-name,
different-ID presets coexist. JSON import counts include both histories, presets and preferences;
Controller refreshes all four separate Training Stores after success, then refreshes
the current runtime preferred reference without recreating the target. Preferences
normalize shape/key/catalogue in db.ts and validate algorithm semantics through the
Training workflow using the supplied KPuzzle. Invalid preferences are skipped.
They upsert by deterministic catalogue key, independently of Session compatibility,
source Solves and Drill preset identity. v5 and older archives without preferences
contribute an empty incoming list without erasing local preferences. CSV remains
Solve-only and its contract is unchanged.

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
Since analysis version 2, `step_N_case` also holds the F2L catalogue case
(`F2L n`) for F2L steps; this was a deliberate change.

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
- XCross/cross generation preferences;
- which chart the result screen shows beside the step breakdown.

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
Rolling trend medians (CFOP phases and measured recognition/execution, up to 10
analysed solves) are Session-local in the same way, and trend charts break and mark
every Session transition. Recent-form comparisons of independent finished results may
span Sessions because they are descriptive medians, not averages.

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
