/**
 * Algorithms for the last-layer cases, one per case.
 *
 * These are not here to be shown to anyone — they are how the recogniser learns what
 * each case looks like. Running one backwards from a solved cube produces the state a
 * solver faces when that case comes up, and every case's state is keyed and looked up.
 * Any correct algorithm for a case would do; these are the primary ones from
 * speedcubedb.com/a/3x3.
 */

/** The 57 OLL cases, by their standard numbers. */
export const OLL_ALGORITHMS: Record<number, string> = {
  1: "R U2 R2 F R F' U2 R' F R F'",
  2: "y' R U' R2 D' r U r' D R2 U R'",
  3: "y' f R U R' U' f' U' F R U R' U' F'",
  4: "y' R' F2 R2 U2 R' F' R U2 R2 F2 R",
  5: "r' U2 R U R' U r",
  6: "r U2 R' U' R U' r'",
  7: "r U R' U R U2 r'",
  8: "y2 r' U' R U' R' U2 r",
  9: "y R U R' U' R' F R2 U R' U' F'",
  10: "R U R' U R' F R F' R U2 R'",
  11: "r' R2 U R' U R U2 R' U M'",
  12: "y' M' R' U' R U' R' U2 R U' M",
  13: "F U R U2 R' U' R U R' F'",
  14: "R' F R U R' F' R F U' F'",
  15: "r' U' r R' U' R U r' U r",
  16: "r U r' R U R' U' r U' r'",
  17: "R U R' U R' F R F' U2 R' F R F'",
  18: "y R U2 R2 F R F' U2 M' U R U' r'",
  19: "y S' R U R' S U' R' F R F'",
  20: "r U R' U' M2 U R U' R' U' M'",
  21: "R U R' U R U' R' U R U2 R'",
  22: "R U2 R2 U' R2 U' R2 U2 R",
  23: "R2 D R' U2 R D' R' U2 R'",
  24: "r U R' U' r' F R F'",
  25: "y F' r U R' U' r' F R",
  26: "y R U2 R' U' R U' R'",
  27: "R U R' U R U2 R'",
  28: "r U R' U' M U R U' R'",
  29: "r2 D' r U r' D r2 U' r' U' r",
  30: "y' r' D' r U' r' D r2 U' r' U r U r'",
  31: "R' U' F U R U' R' F' R",
  32: "S R U R' U' R' F R f'",
  33: "R U R' U' R' F R F'",
  34: "y f R f' U' r' U' R U M'",
  35: "R U2 R2 F R F' R U2 R'",
  36: "y R U R2 F' U' F U R2 U2 R'",
  37: "F R' F' R U R U' R'",
  38: "R U R' U R U' R' U' R' F R F'",
  39: "y' f' r U r' U' r' F r S",
  40: "y R' F R U R' U' F' U R",
  41: "y2 R U R' U R U2 R' F R U R' U' F'",
  42: "R' U' R U' R' U2 R F R U R' U' F'",
  43: "y R' U' F' U F R",
  44: "f R U R' U' f'",
  45: "F R U R' U' F'",
  46: "R' U' R' F R F' U R",
  47: "F' L' U' L U L' U' L U F",
  48: "F R U R' U' R U R' U' F'",
  49: "y2 r U' r2 U r2 U r2 U' r",
  50: "r' U r2 U' r2 U' r2 U r'",
  51: "y2 F U R U' R' U R U' R' F'",
  52: "y2 R' F' U' F U' R U R' U R",
  53: "r' U' R U' R' U R U' R' U2 r",
  54: "r U R' U R U' R' U R U2 r'",
  55: "y R' F U R U' R2 F' R2 U R' U' R",
  56: "r U r' U R U' R' U R U' R' r U' r'",
  57: "R U R' U' M' U R U' r'",
};

/** The 21 PLL cases, by their usual letter names. */
export const PLL_ALGORITHMS: Record<string, string> = {
  Aa: "x (R' U R') D2 (R U' R') D2 R2 x'",
  Ab: "x R2 D2 (R U R') D2 (R U' R) x'",
  E: "y x' (R U' R' D) (R U R' D') (R U R' D) (R U' R' D') x",
  F: "y (R' U' F') (R U R' U') R' F R2 (U' R' U') (R U R' U) R",
  Ga: "R2 (U R' U R' U' R U') R2 D (U' R' U R) D'",
  Gb: "(R' U' R U) D' R2 (U R' U R U' R U') R2 D",
  Gc: "R2 (U' R U' R U R' U) R2 D' (U R U' R') D",
  Gd: "(R U R' U') D R2 (U' R U' R' U R' U) R2 D'",
  H: "(M2 U' M2) U2 (M2 U' M2)",
  Ja: "y (R' U L') U2 (R U' R') U2 R L",
  Jb: "(R U R' F') (R U R' U') R' F R2 U' R'",
  Na: "(R U R' U) (R U R' F') (R U R' U') R' F R2 U' R' U2 (R U' R')",
  Nb: "(R' U R U' R') (F' U' F) (R U R') (F R' F') (R U' R)",
  Ra: "y (R U' R' U') (R U R D) (R' U' R D') (R' U2 R')",
  Rb: "(R' U2) (R U2) (R' F R) (U R' U' R') F' R2",
  T: "(R U R' U') (R' F R2) (U' R' U') (R U R' F')",
  Ua: "y2 (M2 U M) U2 (M' U M2)",
  Ub: "y2 (M2 U' M) U2 (M' U' M2)",
  V: "(R' U R' U') (R D' R' D) (R' U D') (R2 U' R2) D R2",
  Y: "F R (U' R' U') (R U R' F') (R U R' U') (R' F R F')",
  Z: "(M2 U) (M2 U) (M' U2) M2 (U2 M')",
};

/**
 * Which last-layer edges already point up — how solvers narrow an OLL down before
 * reading the corners. Only four arrangements are possible; parity rules out the rest.
 */
export type OllShape = "dot" | "L shape" | "line" | "cross";

/**
 * The OLL cases in each group. Derived from the cases themselves rather than copied
 * from anywhere, and checked against them in the tests.
 */
export const OLL_SHAPE_GROUPS: Record<OllShape, readonly number[]> = {
  dot: [1, 2, 3, 4, 17, 18, 19, 20],
  "L shape": [
    5, 6, 7, 8, 9, 10, 11, 12, 28, 29, 30, 31, 32, 35, 36, 37, 38, 41, 42, 43, 44,
    47, 48, 49, 50, 53, 54,
  ],
  line: [13, 14, 15, 16, 33, 34, 39, 40, 45, 46, 51, 52, 55, 56, 57],
  cross: [21, 22, 23, 24, 25, 26, 27],
};

const SHAPE_BY_CASE = new Map<string, OllShape>(
  Object.entries(OLL_SHAPE_GROUPS).flatMap(([shape, cases]) =>
    cases.map((n) => [String(n), shape as OllShape] as const),
  ),
);

/** The shape group of an OLL case, by its number. */
export function ollShapeForCase(caseName: string): OllShape | null {
  return SHAPE_BY_CASE.get(caseName) ?? null;
}

/** What a step's case is called when there was nothing left to do. */
export const SOLVED_CASE = "Solved";
