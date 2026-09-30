import { F2L_CASES, type F2lCase, type F2lPosition } from "./f2lCases";
import { ADVANCED_F2L_CASES } from "./advancedF2lCases.generated";

export type F2lTrainingLibrary = "basic" | "advanced";
export type AdvancedF2lVariant = { setup: string; algorithms: readonly string[] };
export type AdvancedF2lCase = {
  name: string;
  group: string;
  /** Each position owns a source-derived state, independent of the other positions. */
  variants: Record<F2lPosition, AdvancedF2lVariant>;
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

/** Basic inputs need positioning; Advanced inputs already belong to that position. */
export function f2lTrainingCaseInput(f2lCase: F2lTrainingCase, position: F2lPosition) {
  return f2lCase.library === "basic"
    ? { ...f2lCase, algorithms: f2lCase.algorithms[position], canonical: true }
    : { ...f2lCase.variants[position], canonical: false };
}

export function shortF2lCaseLabel(name: string): string {
  return name.replace(/^(?:F2L|AF2L) /, "#");
}
