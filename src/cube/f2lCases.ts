import { F2L_ALG_BANK } from "./algBank.generated";

/** The four positions a first-two-layers pair can occupy in the solver's grip. */
export const F2L_POSITIONS = ["FR", "FL", "BL", "BR"] as const;
export type F2lPosition = (typeof F2L_POSITIONS)[number];

const F2L_POSITION_LABELS: Record<F2lPosition, string> = {
  FR: "Front Right",
  FL: "Front Left",
  BL: "Back Left",
  BR: "Back Right",
};

export function f2lPositionLabel(position: F2lPosition): string {
  return F2L_POSITION_LABELS[position];
}

export type F2lAlgorithms = Record<F2lPosition, readonly string[]>;

export type F2lCase = {
  /** The case's number, as `"F2L 12"`. */
  name: string;
  group: string;
  /** Produces the case from a solved cube, with the pair belonging to the FR slot. */
  setup: string;
  /** Ordered references for the pair in each positional slot. */
  algorithms: F2lAlgorithms;
};

function algorithmsFor(name: string): F2lAlgorithms {
  const stored = F2L_ALG_BANK[name];
  if (!stored) throw new Error(`Missing F2L algorithm lists for ${name}`);
  return Object.fromEntries(
    F2L_POSITIONS.map((position) => {
      const algorithms = stored[position];
      if (!algorithms || algorithms.length === 0) {
        throw new Error(`Missing F2L ${position} algorithms for ${name}`);
      }
      return [position, algorithms];
    }),
  ) as F2lAlgorithms;
}

const CASES: readonly Omit<F2lCase, "algorithms">[] = [
  { name: "F2L 1", group: "Free pair", setup: "F R' F' R" },
  { name: "F2L 2", group: "Free pair", setup: "R' F R F'" },
  { name: "F2L 3", group: "Free pair", setup: "F' U F" },
  { name: "F2L 4", group: "Free pair", setup: "R U' R'" },
  { name: "F2L 5", group: "Disconnected pair", setup: "R U R' U2' R U' R' U" },
  { name: "F2L 6", group: "Disconnected pair", setup: "F' U' F U2' F' U F U'" },
  { name: "F2L 7", group: "Disconnected pair", setup: "R U R' U2' R U2' R' U" },
  { name: "F2L 8", group: "Disconnected pair", setup: "r' U' R2 U' R2' U2' r" },
  { name: "F2L 9", group: "Disconnected pair", setup: "F' U F U' R U R' U" },
  { name: "F2L 10", group: "Disconnected pair", setup: "R U' R' U' R U' R' U" },
  { name: "F2L 11", group: "Connected pair", setup: "F' U F U' R U2' R' U" },
  { name: "F2L 12", group: "Connected pair", setup: "R U R' U2' R U R' U' R U R'" },
  { name: "F2L 13", group: "Connected pair", setup: "r U2' R' U R U' R' U M" },
  { name: "F2L 14", group: "Connected pair", setup: "R U' R' U' R U R' U" },
  { name: "F2L 15", group: "Connected pair", setup: "R U R' U' R U R' U2' R U' R'" },
  { name: "F2L 16", group: "Connected pair", setup: "F' U F U2' R U R'" },
  { name: "F2L 17", group: "Connected pair", setup: "R U' R' U R U2' R'" },
  { name: "F2L 18", group: "Connected pair", setup: "R U R' U' R U R' F R' F' R" },
  { name: "F2L 19", group: "Disconnected pair", setup: "R U R' U' R U2' R' U'" },
  { name: "F2L 20", group: "Disconnected pair", setup: "R U R' F R' F' R2' U R' U" },
  { name: "F2L 21", group: "Disconnected pair", setup: "R U' R' U2' R U R'" },
  { name: "F2L 22", group: "Disconnected pair", setup: "F' L' U2' L F" },
  { name: "F2L 23", group: "Connected pair", setup: "R U' R' U R U' R' U2' R U' R'" },
  { name: "F2L 24", group: "Connected pair", setup: "R U R' F R U R' U' F'" },
  { name: "F2L 25", group: "Corner in slot", setup: "F' R U R' U' R' F R" },
  { name: "F2L 26", group: "Corner in slot", setup: "F' U' F U R U R' U'" },
  { name: "F2L 27", group: "Corner in slot", setup: "R U R' U' R U R'" },
  { name: "F2L 28", group: "Corner in slot", setup: "R' F R F' U R U' R'" },
  { name: "F2L 29", group: "Corner in slot", setup: "F R' F' R F R' F' R" },
  { name: "F2L 30", group: "Corner in slot", setup: "R U' R' U R U' R'" },
  { name: "F2L 31", group: "Edge in slot", setup: "R U R' F R' F' R U" },
  { name: "F2L 32", group: "Edge in slot", setup: "R U' R' U R U' R' U R U' R'" },
  { name: "F2L 33", group: "Edge in slot", setup: "R U R' U2' R U R' U" },
  { name: "F2L 34", group: "Edge in slot", setup: "R U' R' U2' R U' R' U'" },
  { name: "F2L 35", group: "Edge in slot", setup: "F' U F U' R U' R' U" },
  { name: "F2L 36", group: "Edge in slot", setup: "R U' R' U2' F R' F' R U2'" },
  { name: "F2L 37", group: "Both in slot", setup: "R U' R U2' F R2' F' U2' R2'" },
  { name: "F2L 38", group: "Both in slot", setup: "R U' R' U R U2' R' U R U' R'" },
  { name: "F2L 39", group: "Both in slot", setup: "R U' R' U' R U R' U2' R U' R'" },
  { name: "F2L 40", group: "Both in slot", setup: "R U R' F U R U' R' F' R U R'" },
  { name: "F2L 41", group: "Both in slot", setup: "R F U R U' R' F' U' R'" },
];

export const F2L_CASES: readonly F2lCase[] = CASES.map((f2lCase) => ({
  ...f2lCase,
  algorithms: algorithmsFor(f2lCase.name),
}));
