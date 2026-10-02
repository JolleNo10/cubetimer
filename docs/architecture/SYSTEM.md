# Current system architecture

This document describes the current architecture of cubetimer. It is the
architecture entry point for repository work, not a change proposal or ADR.

## Agent loading

Start here for cross-layer work. For a feature-local change, read the relevant
section below and then inspect only the named code area needed for that task.
There are currently no feature-specific architecture documents.

## Layer ownership

```text
src/cube
  cube/puzzle state
  moves and notation
  scrambles
  solve analysis
  cross/F2L/OLL/PLL domain logic
  narrow domain inputs required by training logic

src/bluetooth
  smart-cube hardware/protocol/timestamp acquisition

src/state
  persisted Session and Solve records
  Settings
  Controller/application orchestration
  IndexedDB
  statistics
  import/export

src/components
  React presentation
```

The physical `CubeModel` is distinct from the virtual cube state used by F2L
training. The cube layer can consume narrow structural facts from a historical
solve, but it does not import the persisted `Solve` record or other state-layer
records.

## Durable invariants

- A `Session` owns the `EventId` for its history.
- A `Solve` belongs to exactly one `Session` through `sessionId` and does not
  duplicate `EventId`.
- `Settings` contains user preferences, not the active event.
- The selected `Session` determines the active event used by the Controller.
- Raw solve facts are authoritative; `SolveAnalysis` is derived and
  rebuildable.
- `src/cube` does not depend on `src/state`.
- The persisted `Solve` record remains in `src/state`; cube-domain functions
  receive narrow structural inputs instead of importing persistence records.
- The physical `CubeModel` remains distinct from virtual F2L training state.

An empty selected Session may change event in place. Once a Session contains a
solve, an event change creates a new Session, preserving the historical
meaning of the existing solves. A normal new Session inherits the selected
Session's event. Session/event context cannot change during inspection or an
active solve.

IndexedDB keeps the existing `sessions`, `solves`, and `settings` stores and
schema version. Loading/import normalizes legacy duplicate `Solve.event`,
legacy `Settings.event`, and missing or invalid Session events into the current
model. JSON exports use version 2, with `EventId` stored only on Sessions;
version 1 imports are normalized one way into that model. The solve-analysis
CSV format has no event column and imported CSV Sessions use the canonical
default event.

## Rejected alternatives

### Event duplication

Rejected:

```text
Store EventId on Session, Solve, and Settings and synchronize them.
```

Reason:

```text
This creates multiple sources of truth and allows session history, statistics,
scramble generation, and recorded solves to disagree about the event.
```

### Moving persisted Solve into cube

Rejected:

```text
Move the complete persisted Solve record into src/cube merely so F2L training
can reference it.
```

Reason:

```text
The persisted Solve contains session, persistence, and interchange metadata
that does not belong to the pure cube domain. F2L training needs only a narrow
subset of historical solve facts.
```
