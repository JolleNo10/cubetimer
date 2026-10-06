/**
 * What a solver actually did within a step, beside what the cube looked like when the
 * step began.
 *
 * The case a step began from is what the solver faced, and stays the case. How they went
 * about it is a separate question: a pair is pulled out of the wrong slot first, a U turn
 * lines it up, or the last layer is done in two looks. So each step is matched against
 * the algorithm bank — what was turned, from the end backwards, compared with every
 * algorithm a solver might have learnt, held any way round — and the last layer is split
 * where the solver stopped to look again.
 *
 * Everything here works in the cross-down frame: `U` is the last layer and the moves
 * are the face turns a smart cube reports. Wide moves, slices and rotations in the
 * catalogue are rewritten into that form by `physicalTurns` before comparing.
 */
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { Alg } from "cubing/alg";
import { F2L_ALG_BANK, OLL_ALG_BANK, PLL_ALG_BANK } from "./algBank.generated";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";
import { recognizeAnyF2lSlot, recognizeF2lSlot } from "./f2l";
import type { F2lPosition } from "./f2lCases";
import { lastLayerEdges, recogniseOll, recognisePll } from "./recognise";
import { TWO_LOOK_CASES } from "./lastLayerTwoLookCases";
import { parseMove, type TimedMove } from "./notation";
import { compose, GENERATORS, IDENTITY, type Orientation } from "./orientation";
import { physicalTurns } from "./physicalTurns";

export type AlgFamily = "F2L" | "OLL" | "PLL";

/** A catalogue algorithm found at the end of what the solver turned. */
export type ExecutedAlg = {
  family: AlgFamily;
  /** As the catalogue writes it, in the grip the solver held. */
  alg: string;
  /** Range within the solve's raw move stream, AUF before it excluded. */
  fromMove: number;
  toMove: number;
};

/**
 * One look at the last layer.
 *
 * `full` is a one-look OLL or PLL. A two-look solver orients the edges and then the
 * corners (`edges`, `corners`), or permutes the corners and then the edges.
 */
export type LastLayerLook = {
  kind: "full" | "edges" | "corners";
  /** The one-look case of the state the look began from, as `recogniseOll`/`recognisePll` name it. */
  case: string | null;
  /** The two-look name, when the look was one: `"I-Shape"`, `"Sune"`, `"Headlights"`, `"Ua"`. */
  label: string | null;
  fromMove: number;
  toMove: number;
  recognitionMs: number;
  alg: string | null;
};

type LexiconEntry = { family: AlgFamily; alg: string; leadingU: boolean };

const AXIS: Record<string, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const ORDER = "UDRLFB";

type Turn = { face: string; amount: number };

/**
 * Two move sequences that do the same thing in the same way read the same.
 *
 * Turns of one face that meet are added up, turns of opposite faces may be reported in
 * either order (an `M` arrives as an `R` and an `L` in whichever order the cube saw
 * them), and the last-layer turns at either end are the solver's lining up rather than
 * the algorithm, so they are dropped. `leadingU` says whether any were.
 */
export function canonicalTurns(tokens: readonly string[]): { key: string; leadingU: boolean } | null {
  const out: Turn[] = [];
  for (const token of tokens) {
    const parsed = parseMove(token);
    if (!parsed || AXIS[parsed.family] === undefined) return null;
    const axis = AXIS[parsed.family];
    // Look back through the run of turns on the same axis for the same face.
    let merged = false;
    for (let i = out.length - 1; i >= 0 && AXIS[out[i].face] === axis; i--) {
      if (out[i].face === parsed.family) {
        out[i].amount = (((out[i].amount + parsed.amount) % 4) + 4) % 4;
        if (out[i].amount === 0) out.splice(i, 1);
        merged = true;
        break;
      }
    }
    if (!merged) {
      const amount = ((parsed.amount % 4) + 4) % 4;
      if (amount !== 0) out.push({ face: parsed.family, amount });
    }
  }
  // Opposite faces commute: sort each same-axis run so the order they were seen in
  // does not matter.
  const sorted: Turn[] = [];
  for (let i = 0; i < out.length; ) {
    let j = i;
    while (j < out.length && AXIS[out[j].face] === AXIS[out[i].face]) j++;
    sorted.push(...out.slice(i, j).sort((a, b) => ORDER.indexOf(a.face) - ORDER.indexOf(b.face)));
    i = j;
  }
  let leadingU = false;
  while (sorted[0]?.face === "U") {
    sorted.shift();
    leadingU = true;
  }
  while (sorted.at(-1)?.face === "U") sorted.pop();
  return { key: sorted.map((turn) => `${turn.face}${turn.amount}`).join(" "), leadingU };
}

/** The four ways to hold a cube with the cross still underneath. */
const Y_GRIPS: Orientation[] = [0, 1, 2, 3].map((times) => {
  let grip = IDENTITY;
  for (let i = 0; i < times; i++) grip = compose(grip, GENERATORS.y);
  return grip;
});

let lexicon: Map<string, Partial<Record<AlgFamily, LexiconEntry>>> | null = null;

function add(family: AlgFamily, algorithms: Iterable<string>) {
  for (const alg of algorithms) {
    for (const grip of Y_GRIPS) {
      let moves: string[];
      try {
        moves = physicalTurns(alg, grip).moves;
      } catch {
        continue;
      }
      const canonical = canonicalTurns(moves);
      if (!canonical || canonical.key === "") continue;
      const entries = lexicon!.get(canonical.key) ?? {};
      entries[family] ??= { family, alg, leadingU: canonical.leadingU };
      lexicon!.set(canonical.key, entries);
    }
  }
}

/** Every catalogue algorithm, keyed by what a smart cube would report for it. */
function algorithmLexicon() {
  if (lexicon) return lexicon;
  lexicon = new Map();
  add("F2L", Object.values(F2L_ALG_BANK).flatMap((positions) => Object.values(positions).flatMap((list) => list ?? [])));
  add("F2L", ADVANCED_F2L_CASES.flatMap((f2lCase) => Object.values(f2lCase.algorithms).flat()));
  add("OLL", [...Object.values(OLL_ALG_BANK).flat(), ...TWO_LOOK_CASES.oll.map((c) => c.algorithm)]);
  add("PLL", [...Object.values(PLL_ALG_BANK).flat(), ...TWO_LOOK_CASES.pll.map((c) => c.algorithm)]);
  return lexicon;
}

/** The catalogue algorithm `tokens` are exactly, give or take AUF. */
export function lookupAlgorithm(tokens: readonly string[], family: AlgFamily): LexiconEntry | null {
  const canonical = canonicalTurns(tokens);
  if (!canonical || canonical.key === "") return null;
  return algorithmLexicon().get(canonical.key)?.[family] ?? null;
}

/** The longest tail of `tokens` that is a catalogue algorithm. */
function longestAlgorithmTail(tokens: readonly string[], family: AlgFamily) {
  for (let start = 0; start < tokens.length; start++) {
    const entry = lookupAlgorithm(tokens.slice(start), family);
    if (entry) return { start, entry };
  }
  return null;
}

const isLastLayerTurn = (token: string) => parseMove(token)?.family === "U";

/** Index of the first turn that is not a `U`, or `tokens.length`. */
function firstNonU(tokens: readonly string[], from = 0): number {
  let i = from;
  while (i < tokens.length && isLastLayerTurn(tokens[i])) i++;
  return i;
}

export type StepInput = {
  kpuzzle: KPuzzle;
  /** The cube before raw move `index`, turned so the cross is underneath. */
  facing: (index: number) => KPattern;
  /** The raw moves of the step, cross-down frame. */
  tokens: readonly string[];
  /** The same moves as recorded, for their times. */
  moves: readonly TimedMove[];
  from: number;
  to: number;
  /** When the step began, in solve time. */
  startMs: number;
};

export type F2lExecution = {
  case: string | null;
  /** Raw move index the case was read at. */
  caseAt: number;
  executedAlg: ExecutedAlg | null;
  /** Turns before the catalogue algorithm that finished the pair, AUF excluded. */
  setupMoves: number;
};

/**
 * Which case a pair was solved from, and how.
 *
 * The case is the one the pair stood as when the step began — basic, or advanced when a
 * piece was stuck in a slot. Only when it began as neither is it read later: where the
 * catalogue algorithm that finished it started, or failing that the first moment it
 * stood as one of the 41. The algorithm itself is reported separately: almost every
 * insertion ends in a trigger that is in the catalogue, so where that trigger began says
 * how the pair went in, not which case it was.
 */
export function f2lExecution(input: StepInput, position: F2lPosition): F2lExecution {
  const { kpuzzle, facing, tokens, from, to } = input;
  if (to <= from) return { case: null, caseAt: from, executedAlg: null, setupMoves: 0 };

  const match = longestAlgorithmTail(tokens, "F2L");
  const executedAlg: ExecutedAlg | null = match
    ? { family: "F2L", alg: match.entry.alg, fromMove: from + (match.entry.leadingU ? match.start : firstNonU(tokens, match.start)), toMove: to }
    : null;
  let caseAt = from;
  if (!recognizeAnyF2lSlot(kpuzzle, facing(from), position)) {
    if (match) caseAt = from + match.start;
    else {
      for (let i = from; i < to; i++) {
        if (recognizeF2lSlot(kpuzzle, facing(i), position).status === "case") {
          caseAt = i;
          break;
        }
      }
    }
  }
  const begins = match ? match.start : caseAt - from;
  const name = recognizeAnyF2lSlot(kpuzzle, facing(caseAt), position)?.name ?? null;
  const setupMoves = tokens.slice(0, begins).filter((token) => !isLastLayerTurn(token)).length;
  return { case: name, caseAt, executedAlg, setupMoves };
}

const TWO_LOOK_OLL_CORNERS: Record<string, string> = {
  "21": "H", "22": "Pi", "23": "U", "24": "T", "25": "L", "26": "Antisune", "27": "Sune",
};
const TWO_LOOK_OLL_EDGES: Record<string, string> = { dot: "Dot Shape", opposite: "I-Shape", adjacent: "L-Shape" };

function lastLayerOriented(pattern: KPattern): boolean {
  const { CORNERS, EDGES } = pattern.patternData;
  for (let i = 0; i < 4; i++) if (CORNERS.orientation[i] !== 0 || EDGES.orientation[i] !== 0) return false;
  return true;
}

const AUF_TURNS = ["", "U", "U2", "U'"];

/** Corners in place for each lining up of the last layer. */
function fixedCorners(pattern: KPattern): number[][] {
  return AUF_TURNS.map((auf) => {
    const turned = auf ? pattern.applyAlg(new Alg(auf)) : pattern;
    const fixed: number[] = [];
    for (let i = 0; i < 4; i++) if (turned.patternData.CORNERS.pieces[i] === i) fixed.push(i);
    return fixed;
  });
}

const cornersPermuted = (pattern: KPattern) => fixedCorners(pattern).some((fixed) => fixed.length === 4);

function cornerLookLabel(pattern: KPattern): string | null {
  const fixed = fixedCorners(pattern);
  if (fixed.some((set) => set.length === 2 && (set[1] - set[0]) % 2 === 1)) return "Headlights";
  if (fixed.some((set) => set.length === 2)) return "Diagonal";
  return null;
}

/**
 * Split a last-layer step into the looks the solver made.
 *
 * A look ends where the first two layers are back together, the last layer has moved
 * on, and either an algorithm from the catalogue has just finished or the solver
 * stopped to look. A step that is one catalogue algorithm end to end is one look,
 * however it happens to pass through intact states on the way.
 */
export function lastLayerLooks(
  input: StepInput,
  family: "OLL" | "PLL",
  f2lIntact: (index: number) => boolean,
  pauseMs: number,
): LastLayerLook[] {
  const { kpuzzle, facing, tokens, moves, from, to, startMs } = input;
  if (to <= from || firstNonU(tokens) === tokens.length) return [];

  const boundaries = [0];
  if (!lookupAlgorithm(tokens, family)) {
    for (let b = 1; b < tokens.length; b++) {
      const look = boundaries.at(-1)!;
      if (firstNonU(tokens, look) >= b || firstNonU(tokens, b) === tokens.length) continue;
      if (!f2lIntact(from + b)) continue;
      const state = facing(from + b);
      if (family === "OLL" ? lastLayerOriented(state) : false) continue;
      const paused = moves[b].t - moves[b - 1].t >= pauseMs;
      if (paused || lookupAlgorithm(tokens.slice(look, b), family)) boundaries.push(b);
    }
  }

  return boundaries.map((start, i) => {
    const end = boundaries[i + 1] ?? tokens.length;
    const begin = facing(from + start);
    const finish = facing(from + end);
    const slice = tokens.slice(start, end);
    const entry = lookupAlgorithm(slice, family);
    let kind: LastLayerLook["kind"] = "full";
    let label: string | null = null;
    const caseName = family === "OLL" ? recogniseOll(kpuzzle, begin) : recognisePll(kpuzzle, begin);
    if (boundaries.length > 1) {
      if (family === "OLL") {
        if (lastLayerEdges(begin) === "cross") {
          kind = "corners";
          label = caseName ? (TWO_LOOK_OLL_CORNERS[caseName] ?? null) : null;
        } else if (lastLayerEdges(finish) === "cross" && !lastLayerOriented(finish)) {
          kind = "edges";
          label = TWO_LOOK_OLL_EDGES[lastLayerEdges(begin)] ?? null;
        }
      } else if (cornersPermuted(begin)) {
        kind = "edges";
        label = caseName;
      } else if (cornersPermuted(finish)) {
        kind = "corners";
        label = cornerLookLabel(begin);
      }
    }
    const lookStartMs = start === 0 ? startMs : moves[start - 1].t;
    const firstMove = entry?.leadingU ? start : firstNonU(tokens, start);
    const recognitionMs = Math.max(0, (moves[Math.min(firstMove, end - 1)]?.t ?? lookStartMs) - lookStartMs);
    return {
      kind,
      case: caseName,
      label,
      fromMove: from + start,
      toMove: from + end,
      recognitionMs,
      alg: entry?.alg ?? null,
    };
  });
}
