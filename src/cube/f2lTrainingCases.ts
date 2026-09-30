import { Alg } from "cubing/alg";
import { F2L_CASES, positionF2lAlgorithm, type F2lCase, type F2lPosition } from "./f2lCases";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";

export type F2lTrainingLibrary = "basic" | "advanced";
export type AdvancedF2lCase = {
  name: string;
  group: string;
  /** Exact published SpeedCubeDB setup in its canonical orientation. */
  setup: string;
  /** Intended pair's home slot in that orientation, derived from source behaviour. */
  canonicalTarget: F2lPosition;
  /** Validated source-ranked references, keyed by the requested target position. */
  algorithms: Record<F2lPosition, readonly string[]>;
};
export type F2lTrainingCase =
  | (F2lCase & { library: "basic" })
  | (AdvancedF2lCase & { library: "advanced" });

/** Training catalogue boundary. Standard recognition continues to own only F2L_CASES. */
export const F2L_TRAINING_CATALOGUES = {
  basic: {
    library: "basic", label: "Basic",
    cases: F2L_CASES.map((f2lCase) => ({ ...f2lCase, library: "basic" as const })),
  },
  advanced: {
    library: "advanced", label: "Advanced",
    cases: ADVANCED_F2L_CASES.map((f2lCase) => ({ ...f2lCase, library: "advanced" as const })),
  },
} as const;

export function f2lTrainingCatalogue(library: F2lTrainingLibrary) {
  return F2L_TRAINING_CATALOGUES[library];
}

export function findF2lTrainingCase(library: F2lTrainingLibrary, name: string): F2lTrainingCase | undefined {
  return f2lTrainingCatalogue(library).cases.find((f2lCase) => f2lCase.name === name);
}

/** Position the whole authoritative case, not just the intended pair. */
export function f2lTrainingCaseInput(f2lCase: F2lTrainingCase, position: F2lPosition) {
  const from = f2lCase.library === "basic" ? "FR" : f2lCase.canonicalTarget;
  return {
    setup: positionF2lAlgorithm(new Alg(f2lCase.setup), from, position).toString(),
    algorithms: f2lCase.algorithms[position],
  };
}

export function shortF2lCaseLabel(name: string): string {
  return name.replace(/^(?:F2L|AF2L) /, "#");
}
