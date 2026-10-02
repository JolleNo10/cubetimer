import type { LastLayerCompletionGoal, LastLayerFamily } from "./lastLayerTraining";

type TwoLookCase = {
  id: string;
  group: string;
  algorithm: string;
  completionGoal: LastLayerCompletionGoal;
};

/** Checked-in J Perm authority; never fetched by the application at runtime. */
export const TWO_LOOK_SOURCES = {
  oll: "https://jperm.net/algs/2lookoll",
  pll: "https://jperm.net/algs/2look/pll",
} as const;

export const TWO_LOOK_CASES: Record<LastLayerFamily, readonly TwoLookCase[]> = {
  oll: [
    { id: "Dot Shape", group: "1: Edges", algorithm: "F R U R' U' F' f R U R' U' f'", completionGoal: "orient-edges" },
    { id: "I-Shape", group: "1: Edges", algorithm: "F R U R' U' F'", completionGoal: "orient-edges" },
    { id: "L-Shape", group: "1: Edges", algorithm: "f R U R' U' f'", completionGoal: "orient-edges" },
    { id: "Antisune", group: "2: Corners", algorithm: "R U2 R' U' R U' R'", completionGoal: "orient-last-layer" },
    { id: "H", group: "2: Corners", algorithm: "R U R' U R U' R' U R U2 R'", completionGoal: "orient-last-layer" },
    { id: "L", group: "2: Corners", algorithm: "F R' F' r U R U' r'", completionGoal: "orient-last-layer" },
    { id: "Pi", group: "2: Corners", algorithm: "R U2 R2 U' R2 U' R2 U2 R", completionGoal: "orient-last-layer" },
    { id: "Sune", group: "2: Corners", algorithm: "R U R' U R U2 R'", completionGoal: "orient-last-layer" },
    { id: "T", group: "2: Corners", algorithm: "r U R' U' r' F R F'", completionGoal: "orient-last-layer" },
    { id: "U", group: "2: Corners", algorithm: "R2 D R' U2 R D' R' U2 R'", completionGoal: "orient-last-layer" },
  ],
  pll: [
    { id: "Diagonal", group: "1: Corners", algorithm: "F R U' R' U' R U R' F' R U R' U' R' F R F'", completionGoal: "permute-corners" },
    { id: "Headlights", group: "1: Corners", algorithm: "R U R' U' R' F R2 U' R' U' R U R' F'", completionGoal: "permute-corners" },
    { id: "H", group: "2: Edges", algorithm: "M2 U M2 U2 M2 U M2", completionGoal: "solve-cube" },
    { id: "Ua", group: "2: Edges", algorithm: "R U' R U R U R U' R' U' R2", completionGoal: "solve-cube" },
    { id: "Ub", group: "2: Edges", algorithm: "R2 U R U R' U' R' U' R' U R'", completionGoal: "solve-cube" },
    { id: "Z", group: "2: Edges", algorithm: "M' U M2 U M2 U M' U2 M2", completionGoal: "solve-cube" },
  ],
};
