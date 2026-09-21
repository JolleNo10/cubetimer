/**
 * Working out which OLL and PLL case a solver was looking at.
 *
 * Both are decided by the state of the last layer at the moment the step begins, and
 * both are named independently of how the cube happened to be turned at the time: the
 * same case is the same case whichever way it is facing (`y`) and whatever AUF the
 * solver had done (`U`).
 *
 * Rather than reason about canonical forms, each case's whole orbit under those
 * sixteen turns is generated once from its algorithm and every member is put in a
 * lookup table. Recognition is then a plain map lookup on the state in front of us.
 */
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { OLL_ALGORITHMS, PLL_ALGORITHMS, SOLVED_CASE } from "./lastLayerCases";

/** Last-layer slots, which are the first four of each orbit in cubing.js's ordering. */
const LAST_LAYER_SLOTS = 4;

/** The state of the last layer, ignoring where the pieces are. */
function orientationKey(pattern: KPattern): string {
  const { CORNERS, EDGES } = pattern.patternData;
  const parts: number[] = [];
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) parts.push(CORNERS.orientation[i]);
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) parts.push(EDGES.orientation[i]);
  return parts.join("");
}

/** The state of the last layer, ignoring which way the pieces are facing. */
function permutationKey(pattern: KPattern): string {
  const { CORNERS, EDGES } = pattern.patternData;
  const parts: number[] = [];
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) parts.push(CORNERS.pieces[i]);
  for (let i = 0; i < LAST_LAYER_SLOTS; i++) parts.push(EDGES.pieces[i]);
  return parts.join("");
}

function isOriented(pattern: KPattern): boolean {
  return orientationKey(pattern) === "00000000";
}

function isPermuted(pattern: KPattern): boolean {
  return permutationKey(pattern) === "01230123";
}

const QUARTER_TURNS = [0, 1, 2, 3];

const repeatAlg = (move: string, times: number) =>
  new Alg(Array.from({ length: times }, () => move).join(" "));

/**
 * Every state that counts as the same case.
 *
 * A solver lines the layer up before the algorithm and again after it, and may be
 * holding the cube any way round. All three are free choices that do not change which
 * case it was, so a case is the whole orbit of its state under them — sixty-four
 * states, not one.
 */
function* caseVariants(
  kpuzzle: KPuzzle,
  algorithm: Alg,
): Generator<KPattern> {
  for (const before of QUARTER_TURNS) {
    for (const after of QUARTER_TURNS) {
      // The solver's state is whatever "AUF, algorithm, AUF" undoes.
      const solvedBy = repeatAlg("U", before)
        .concat(algorithm)
        .concat(repeatAlg("U", after));
      const state = kpuzzle.defaultPattern().applyAlg(solvedBy.invert());
      for (const facing of QUARTER_TURNS) {
        yield reframe(kpuzzle, state, repeatAlg("y", facing));
      }
    }
  }
}

/**
 * Re-express a state as it looks with the cube held a different way round.
 *
 * Physically rotating the pattern is not enough: a piece keeps its identity when the
 * cube turns, so after a `z2` the top layer is full of pieces numbered as bottom-layer
 * ones and nothing matches. Conjugating by the rotation relabels the slots and the
 * pieces together, which is what "the same case, seen from the other side" means.
 */
export function reframe(
  kpuzzle: KPuzzle,
  pattern: KPattern,
  rotation: Alg,
): KPattern {
  if (rotation.experimentalNumChildAlgNodes() === 0) return pattern;
  const state = pattern.experimentalToTransformation();
  if (!state) return pattern.applyAlg(rotation);
  const turn = kpuzzle.algToTransformation(rotation);
  return kpuzzle
    .defaultPattern()
    .applyTransformation(
      turn.invert().applyTransformation(state).applyTransformation(turn),
    );
}

/**
 * Undo any whole-cube rotation an algorithm left behind, so every case state is
 * expressed with the last layer on top and the centres where they belong.
 */
function withCentresHome(kpuzzle: KPuzzle, pattern: KPattern): KPattern {
  const solvedCentres = kpuzzle.defaultPattern().patternData.CENTERS.pieces;
  const centresMatch = (candidate: KPattern) =>
    candidate.patternData.CENTERS.pieces.every(
      (piece, i) => piece === solvedCentres[i],
    );
  if (centresMatch(pattern)) return pattern;
  for (const x of ["", "x", "x2", "x'", "z", "z'"]) {
    for (const y of ["", "y", "y2", "y'"]) {
      const candidate = pattern.applyAlg(new Alg(`${x} ${y}`.trim()));
      if (centresMatch(candidate)) return candidate;
    }
  }
  return pattern;
}

type CaseTable = {
  /** Every state of every case, keyed for direct lookup. */
  byKey: Map<string, string>;
  /** Cases whose algorithm did not produce a usable last-layer state. */
  rejected: string[];
};

/**
 * Build the lookup for one family of cases.
 *
 * `keyOf` decides what makes two states the same case: orientation for OLL, where the
 * pieces sit for PLL.
 */
function buildTable(
  kpuzzle: KPuzzle,
  algorithms: Record<string, string>,
  keyOf: (pattern: KPattern) => string,
  isValidCaseState: (pattern: KPattern) => boolean,
): CaseTable {
  const byKey = new Map<string, string>();
  const rejected: string[] = [];

  for (const [name, algorithm] of Object.entries(algorithms)) {
    // Running the algorithm backwards from solved gives the state it solves.
    const state = withCentresHome(
      kpuzzle,
      kpuzzle.defaultPattern().applyAlg(new Alg(algorithm).invert()),
    );
    if (!isValidCaseState(state)) {
      rejected.push(name);
      continue;
    }
    for (const variant of caseVariants(kpuzzle, new Alg(algorithm))) {
      const key = keyOf(variant);
      // First writer wins, so a genuine clash is visible rather than silently
      // overwritten; the tests assert there are none.
      if (!byKey.has(key)) byKey.set(key, name);
    }
  }
  return { byKey, rejected };
}

export type LastLayerTables = {
  oll: CaseTable;
  pll: CaseTable;
};

const tables = new WeakMap<KPuzzle, LastLayerTables>();

export function lastLayerTables(kpuzzle: KPuzzle): LastLayerTables {
  const existing = tables.get(kpuzzle);
  if (existing) return existing;
  const built: LastLayerTables = {
    // An OLL state has the first two layers done and the last layer unoriented.
    oll: buildTable(
      kpuzzle,
      Object.fromEntries(
        Object.entries(OLL_ALGORITHMS).map(([n, alg]) => [String(n), alg]),
      ),
      orientationKey,
      (pattern) => !isOriented(pattern),
    ),
    // A PLL state is oriented, and only the last layer is out of place.
    pll: buildTable(kpuzzle, PLL_ALGORITHMS, permutationKey, (pattern) =>
      isOriented(pattern) && !isPermuted(pattern),
    ),
  };
  // A last layer that only needs lining up is a PLL skip, not an unknown case.
  for (const variant of caseVariants(kpuzzle, new Alg(""))) {
    built.pll.byKey.set(permutationKey(variant), SOLVED_CASE);
  }
  tables.set(kpuzzle, built);
  return built;
}

/**
 * Name the OLL case a solver faced. `pattern` must be the cube as it stood when the
 * step began, turned so the cross is on the bottom.
 */
export function recogniseOll(kpuzzle: KPuzzle, pattern: KPattern): string | null {
  if (isOriented(pattern)) return SOLVED_CASE;
  return lastLayerTables(kpuzzle).oll.byKey.get(orientationKey(pattern)) ?? null;
}

/** Name the PLL case a solver faced, in the same terms. */
export function recognisePll(kpuzzle: KPuzzle, pattern: KPattern): string | null {
  if (!isOriented(pattern)) return null;
  return lastLayerTables(kpuzzle).pll.byKey.get(permutationKey(pattern)) ?? null;
}

export { SOLVED_CASE };
