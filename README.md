# cubetimer

A speedcubing timer for Bluetooth smart cubes, in the browser. Connect a GAN cube and
the app follows every turn: it watches you apply the scramble, starts the clock on your
first move, stops the moment the cube is solved, and breaks the solve down into cross,
F2L, OLL and PLL.

Built on [cubing.js](https://js.cubing.net/cubing/) for scrambles, cube state and 3D
rendering, and on [gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth)
for the cube protocols.

## Features

**Smart cube**
- Connects over Web Bluetooth, with automatic protocol detection.
- Live 3D cube mirroring the real one, including gyroscope orientation.
- Scrambles are shown white on top and green in front, the orientation they are applied
  in; during a solve the cube is turned over so your cross colour is underneath, the way
  you are actually holding it.
- Turn the top face three times, while nothing is being timed, to line the 3D view up
  with however you are holding the cube — no need to put it down and reach for a button.
- Set which colour goes underneath and which faces you, so the cube on screen is turned
  the way the one in your hands is.
- Battery level, firmware and hardware details.
- State sync: re-read the cube at any time, or tell it that it is solved.

**Scrambling**
- WCA random-state scrambles for every official event.
- Live scramble tracking — moves you have applied are struck through, the next one is
  highlighted, and a progress bar fills as you go.
- Turn the wrong face and it offers the shortest way back, whether that is undoing one
  move or going straight to the scrambled state. You can also take whatever state the
  cube is in and use that as the scramble.

**Timing**
- Starts on your first turn, stops when the cube is solved — no hands on a keyboard.
- Cube timestamps are fitted against the host clock, removing the drift in the cube's
  own oscillator while keeping its much finer resolution.
- Optional WCA inspection with +2 and DNF penalties, and audible warnings.
- Keyboard and touch timing for when no cube is connected.

**Your solve history**
- Reads and writes the solve analysis CSV export: all 164 columns, every step, case, turn
  count and move timestamp. A 47,000-solve archive imports in under 20 seconds.
- Solves keep their ids, so re-importing the same file updates rather than duplicates.
- Solves recorded here export in the same format, so they are not trapped in this app.

**Slow solve**
- Takes the clock away. Solves are still recorded, broken down and replayable, but the
  timer counts moves instead of seconds and these solves never touch your averages or
  personal bests.

**Analysis tools**
- The best cross available from the scramble, solved exactly rather than estimated —
  the whole problem is four edges, so it fits in a table and has no depth limit.
- For each step, the shortest way to have reached the same position, searched
  exhaustively up to eleven moves, so "already the shortest" means there is nothing
  better rather than that nothing was found.
- The standard algorithm for the OLL and PLL case you had, to compare yours against.
- A solver's solution to the whole scramble, as a yardstick for the move count.

**After the solve**
- CFOP breakdown: time, moves and TPS for the cross, each F2L pair, OLL and PLL, split
  into recognition and execution, plus a per-move time graph and a list of pauses.
- Names the OLL case (1–57) and PLL case (Aa … Z) you were looking at, whichever way
  you were holding the cube, with the OLL's shape group beside it (fish, awkward,
  knight move …), and marks a step as a skip when there was nothing to do.
- Says which pair went into which slot, by the colours that meet there — the
  green-red slot, not "FR" — and which colour you crossed on.
- Turns counted three ways — STM, ETM and QTM — per step and per solve.
- The analysis works whatever colour you cross on and however you hold the cube.
- Move-by-move replay at the speed you actually turned, with scrubbing, the breakdown
  beside it, and the solve replayed in the grip it was done with. Pick a step to jump
  to the state it began from — click F2L Slot 1 and the cross is done with the first
  pair still to come.
- Sessions, ao5/ao12/ao50/ao100 with WCA trimming rules, PB tracking, +2/DNF, notes.
- Everything is stored locally in IndexedDB, and can be exported and re-imported.

**No cube?** Turn on the virtual cube and drive everything from the keyboard.

## Supported cubes

`gan-web-bluetooth` handles three generations of the GAN protocol, and the right one is
chosen from the services the cube advertises:

| Protocol | Cubes |
| --- | --- |
| Gen2 | GAN 12 ui, GAN 12 ui FreePlay, GAN Mini ui FreePlay, GAN 356 i Carry, GAN 356 i Carry S, GAN 356 i 3, Monster Go 3Ai, MoYu AI 2023 |
| Gen3 | GAN 356 i Carry 2 |
| Gen4 | GAN 12 ui Maglev, GAN 14 ui FreePlay |

## Running it

```sh
npm install
npm run dev              # http://localhost:5173
```

### A different port

`PORT` works for the dev server, the preview server and the containers:

```sh
PORT=4123 npm run dev
npm run dev -- --port 4123    # a flag still wins
```

### With OrbStack / Docker

```sh
PORT=4123 docker compose up dev     # Vite with hot reloading, source bind-mounted
PORT=4123 docker compose up prod    # production build behind nginx
```

The dev container polls the bind-mounted source files, so edits are picked up reliably
by Docker Desktop on Windows.

Then open **http://localhost:4123**.

OrbStack also gives the container a domain, `http://cubetimer-dev-1.orb.local`, and
Vite is configured to accept it — but **do not use it for smart cube work**. Web
Bluetooth is only available in a secure context, and an `.orb.local` domain over plain
HTTP is not one:

| URL | Secure context | `navigator.bluetooth` |
| --- | --- | --- |
| `http://localhost:4123` | yes | available |
| `http://cubetimer-dev-1.orb.local` | no | **missing** |
| `https://…` anywhere | yes | available |

The published port on `localhost` is the one to use. Everything else about the app
works fine over the `.orb.local` domain.

### From a phone, or another machine

Bluetooth needs HTTPS off `localhost`, so serve it with a self-signed certificate:

```sh
PORT=4123 HTTPS=1 npm run dev
```

Accept the certificate warning once; the page is then a secure context and the cube
will connect. Add any extra hostnames Vite should answer to with
`ALLOWED_HOSTS=my-host.example,other-host`. If nothing on your network can reach the
port, check that your firewall allows incoming connections for Node.

### Other commands

```sh
npm run build      # typecheck and bundle to dist/
npm run preview    # serve dist/ locally
npm test           # unit tests
npm run test:e2e   # drives a full scramble and solve through a real browser
npm run test:import ~/Downloads/solves.csv   # imports a real export through the UI
npm run test:repair  # checks an old-format solve gets its breakdown rebuilt
npm run test:gesture # checks the recentre gesture fires only when it should
npm run test:replay  # checks each step jumps to the moment it began
npm run test:slow    # checks slow solves are recorded but never counted
```

The end-to-end script needs a server already running and Chrome installed. Point it
wherever you like: `BASE_URL=http://localhost:4123/ npm run test:e2e`.

## Browser support

Web Bluetooth is required for smart cube features: Chrome or Edge on desktop and
Android, or Bluefy on iOS. Safari and Firefox will run everything else — scrambles,
keyboard timing, statistics — but cannot talk to a cube.

On Chrome for macOS and Windows the browser will not reveal a device's Bluetooth
address, which is needed to derive the cube's decryption key. The app asks for it once
and remembers it. You can read it from the GAN app under Cube → Information, or from a
scanner app such as nRF Connect.

## The solve model

The unit of data is a solve: a scramble, a stream of timestamped moves, and a CFOP
analysis of seven steps (cross, four F2L slots, OLL, PLL). It is the same model the
solve analysis CSV format uses, which is what lets solves move in and out of this app
without losing anything.

Faces are reported by colour rather than by letter. A cube reports its turns as `U`,
`R`, `F` and so on relative to its own centres, which never move — so a solver who
scrambles with white on top and then turns the cube over to build the cross is, as far
as the cube is concerned, crossing on `U`. The breakdown says "cross on white" and names
each slot by the two colours that meet in it, because that is what the solver saw.

A breakdown is derived data, not a record: the scramble and the move stream are the
facts, and the steps are what this app makes of them. So a solve whose breakdown cannot
be read — because it was stored under an earlier version of the model — is re-analysed
from its moves when it loads, and the result is saved back.

Each step carries its moves in the frame the solver held the cube in, the time it took,
that time split into recognition and execution, a cumulative time, three turn counts
and the case that came up. A few conventions matter:

- **Time zero is the first turn.** A move's timestamp is when that move *finished*, so
  a step ends at the timestamp of its last move and the next one starts from there.
- **Recognition ends at the first move that is not an AUF.** Turning the last layer at
  the start of a step is lining up a case you have already seen, not solving it.
- **Turns per second are measured against turning time**, not the whole step, so a long
  pause does not make you look slow at execution. The figure for the whole solve is
  measured against the whole solve.
- **A slice is one turn in STM, two in ETM, and two per quarter in QTM.** Rotations
  count for nothing in all three.
- **Two turns of the same face merge into one move** when they go the same way and are
  less than 750 ms apart — one motion, not two decisions.

Those rules were derived from, and checked against, a real 47,000-solve export: the
turn counts, recognition/execution split, cumulative times and rate formatting all
reproduce its figures exactly.

OLL shape groups come from speedcubedb.com/a/3x3, since a "fish" is a fish because it
looks like one and cannot be worked out from the cube. The four groups that *are*
statements about the cube — dot, OCLL, L and line — are checked against it in the tests.

Last-layer cases are read from the state at the moment the step begins. Each case is
stored as its whole orbit — every AUF before the algorithm, every AUF after it, and
every way round the cube can be held — so recognition is a direct lookup rather than a
guess. Checked against 20,000 solves whose cases were labelled independently, it names
the same case **every time**: 19,912 OLL and 19,924 PLL, no disagreements.

Given the same scramble and move stream, this app's own analyser agrees with the
analysis in that export on the cross face for about 84% of solves, and on all seven
step boundaries for about 80%. The rest are honest differences in how a phase is
attributed: the reference analysis appears to follow which pair a run of moves is
working on, where this app reads the cube state alone. Imported solves keep the
numbers they arrived with — nothing is recomputed.

## How it fits together

```
src/
  cube/        Cube state, scrambles and analysis — no UI, no Bluetooth
    facelets   Kociemba facelet strings <-> cubing.js KPattern
    model      The cube as the app believes it to be
    scramble   Scramble generation, and tracking the cube along a scramble
    notation   Move parsing, turn metrics, timestamped move streams
    orientation Rewriting a solve into the frame the solver held the cube in
    analysis   CFOP step detection and per-step metrics
    crossSolver Exact shortest cross, by breadth-first search over all 331,776 states
    optimise   Searching for a shorter way to have done a step
    recognise  Naming the OLL and PLL case a solver faced
    solver     Shortest sequence between two states
  bluetooth/   The GAN connection, and move timestamp fitting
  state/       Controller (timer state machine), IndexedDB storage, statistics
    solveCsv   The solve analysis CSV format, read and written
  components/  React UI
scripts/
  cubingSearchWorkerPlugin.ts   Emits cubing.js's solver worker for production builds
  e2e.mjs                       End-to-end browser check
  importCheck.mjs               Imports a real CSV export through the UI
  compareAnalysis.ts            Checks this analyser against an export's own, solve by solve
```

The controller owns all the logic and lives outside React. Move events arrive up to
about twenty times a second and the clock updates every frame, so those are published
through narrow stores that only the affected components subscribe to — turning the cube
never re-renders the page.

`src/cube` is deliberately free of UI and Bluetooth concerns, which is what makes it
testable: the analyser is checked against solves built backwards from a solved cube, and
the facelet conversion against reference vectors from an independent implementation.
