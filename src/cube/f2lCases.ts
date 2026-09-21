/**
 * The 41 F2L cases, from speedcubedb.com/a/3x3/F2L — the same source the OLL and PLL
 * algorithms come from.
 *
 * Each case is defined by its `setup`: the sequence that produces it from a solved
 * cube. That is what the recogniser learns each case's shape from. The algorithm alone
 * would not do — several of them begin with an AUF or a rotation, so running one
 * backwards says where the solver's hands were as much as what they were looking at.
 *
 * `alg` is the primary algorithm listed for the case, written for the pair going into
 * the front-right slot with the cross underneath. `group` is speedcubedb's grouping,
 * worded for one case rather than a shelf of them — it is how a solver reads a case
 * before naming it: is the pair already connected, is one of its pieces stuck in the
 * slot, and so on.
 *
 * Both sequences are recorded exactly as the site writes them, `U2'` and all, so they
 * can be compared against it without translation.
 */

export type F2lCase = {
  /** The case's number, as `"F2L 12"`. */
  name: string;
  group: string;
  /** Produces the case from a solved cube, with the pair belonging to the FR slot. */
  setup: string;
  /** Solves it, from the state `setup` leaves behind. */
  alg: string;
};

export const F2L_CASES: readonly F2lCase[] = [
  { name: "F2L 1", group: "Free pair", setup: "F R' F' R", alg: "U R U' R'" },
  { name: "F2L 2", group: "Free pair", setup: "R' F R F'", alg: "F R' F' R" },
  { name: "F2L 3", group: "Free pair", setup: "F' U F", alg: "F' U' F" },
  { name: "F2L 4", group: "Free pair", setup: "R U' R'", alg: "R U R'" },
  { name: "F2L 5", group: "Disconnected pair", setup: "R U R' U2' R U' R' U", alg: "U' R U R' U2 R U' R'" },
  { name: "F2L 6", group: "Disconnected pair", setup: "F' U' F U2' F' U F U'", alg: "U' r U' R' U R U r'" },
  { name: "F2L 7", group: "Disconnected pair", setup: "R U R' U2' R U2' R' U", alg: "U' R U2 R' U' R U2 R'" },
  { name: "F2L 8", group: "Disconnected pair", setup: "r' U' R2 U' R2' U2' r", alg: "r' U2 R2 U R2 U r" },
  { name: "F2L 9", group: "Disconnected pair", setup: "F' U F U' R U R' U", alg: "U' R U' R' U F' U' F" },
  { name: "F2L 10", group: "Disconnected pair", setup: "R U' R' U' R U' R' U", alg: "U' R U R' U R U R'" },
  { name: "F2L 11", group: "Connected pair", setup: "F' U F U' R U2' R' U", alg: "U' R U2 R' U F' U' F" },
  { name: "F2L 12", group: "Connected pair", setup: "R U R' U2' R U R' U' R U R'", alg: "R U' R' U R U' R' U2 R U' R'" },
  { name: "F2L 13", group: "Connected pair", setup: "r U2' R' U R U' R' U M", alg: "y' U R' U R U' R' U' R" },
  { name: "F2L 14", group: "Connected pair", setup: "R U' R' U' R U R' U", alg: "U' R U' R' U R U R'" },
  { name: "F2L 15", group: "Connected pair", setup: "R U R' U' R U R' U2' R U' R'", alg: "M U r U' r' U' M'" },
  { name: "F2L 16", group: "Connected pair", setup: "F' U F U2' R U R'", alg: "R U' R' U2 F' U' F" },
  { name: "F2L 17", group: "Connected pair", setup: "R U' R' U R U2' R'", alg: "R U2 R' U' R U R'" },
  { name: "F2L 18", group: "Connected pair", setup: "R U R' U' R U R' F R' F' R", alg: "y' R' U2 R U R' U' R" },
  { name: "F2L 19", group: "Disconnected pair", setup: "R U R' U' R U2' R' U'", alg: "U R U2 R' U R U' R'" },
  { name: "F2L 20", group: "Disconnected pair", setup: "R U R' F R' F' R2' U R' U", alg: "y' U' R' U2 R U' R' U R" },
  { name: "F2L 21", group: "Disconnected pair", setup: "R U' R' U2' R U R'", alg: "U2 R U R' U R U' R'" },
  { name: "F2L 22", group: "Disconnected pair", setup: "F' L' U2' L F", alg: "r U' r' U2 r U r'" },
  { name: "F2L 23", group: "Connected pair", setup: "R U' R' U R U' R' U2' R U' R'", alg: "U R U' R' U' R U' R' U R U' R'" },
  { name: "F2L 24", group: "Connected pair", setup: "R U R' F R U R' U' F'", alg: "F U R U' R' F' R U' R'" },
  { name: "F2L 25", group: "Corner in slot", setup: "F' R U R' U' R' F R", alg: "U' R' F R F' R U R'" },
  { name: "F2L 26", group: "Corner in slot", setup: "F' U' F U R U R' U'", alg: "U R U' R' F R' F' R" },
  { name: "F2L 27", group: "Corner in slot", setup: "R U R' U' R U R'", alg: "R U' R' U R U' R'" },
  { name: "F2L 28", group: "Corner in slot", setup: "R' F R F' U R U' R'", alg: "R U R' U' F R' F' R" },
  { name: "F2L 29", group: "Corner in slot", setup: "F R' F' R F R' F' R", alg: "R' F R F' U R U' R'" },
  { name: "F2L 30", group: "Corner in slot", setup: "R U' R' U R U' R'", alg: "R U R' U' R U R'" },
  { name: "F2L 31", group: "Edge in slot", setup: "R U R' F R' F' R U", alg: "U' R' F R F' R U' R'" },
  { name: "F2L 32", group: "Edge in slot", setup: "R U' R' U R U' R' U R U' R'", alg: "U R U' R' U R U' R' U R U' R'" },
  { name: "F2L 33", group: "Edge in slot", setup: "R U R' U2' R U R' U", alg: "U' R U' R' U2 R U' R'" },
  { name: "F2L 34", group: "Edge in slot", setup: "R U' R' U2' R U' R' U'", alg: "U R U R' U2 R U R'" },
  { name: "F2L 35", group: "Edge in slot", setup: "F' U F U' R U' R' U", alg: "U' R U R' U F' U' F" },
  { name: "F2L 36", group: "Edge in slot", setup: "R U' R' U2' F R' F' R U2'", alg: "U F' U' F U' R U R'" },
  { name: "F2L 37", group: "Both in slot", setup: "R U' R U2' F R2' F' U2' R2'", alg: "R2 U2 F R2 F' U2 R' U R'" },
  { name: "F2L 38", group: "Both in slot", setup: "R U' R' U R U2' R' U R U' R'", alg: "R U' R' U' R U R' U2 R U' R'" },
  { name: "F2L 39", group: "Both in slot", setup: "R U' R' U' R U R' U2' R U' R'", alg: "R U' R' U R U2 R' U R U' R'" },
  { name: "F2L 40", group: "Both in slot", setup: "R U R' F U R U' R' F' R U R'", alg: "r U' r' U2 r U r' R U R'" },
  { name: "F2L 41", group: "Both in slot", setup: "R F U R U' R' F' U' R'", alg: "R U' R' r U' r' U2 r U r'" },
];
