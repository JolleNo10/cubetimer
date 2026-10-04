import { Move } from "cubing/alg";
import type { Face } from "./moves";
import { OUTER_FACES } from "./notation";
import { IDENTITY, type Orientation } from "./orientation";

export type MoveGuide = {
  token: string;
  kind: "outer" | "wide" | "slice" | "rotation";
  axis: "x" | "y" | "z";
  /** A layer interval in the caller's fixed display frame, from -1 to 1. */
  layers: readonly [number, number];
  /** Right-hand rotation about the positive axis; half turns have no required direction. */
  direction: -1 | 1;
  halfTurn: boolean;
};

const GUIDE_FACES = {
  R: { axis: "x", side: 1 }, L: { axis: "x", side: -1 },
  U: { axis: "y", side: 1 }, D: { axis: "y", side: -1 },
  F: { axis: "z", side: 1 }, B: { axis: "z", side: -1 },
} as const;

type GuideKind = MoveGuide["kind"];
const GUIDE_FAMILIES: Record<string, { face: Face; kind: GuideKind }> = {
  ...Object.fromEntries(OUTER_FACES.flatMap((face) => [
    [face, { face, kind: "outer" }],
    [face.toLowerCase(), { face, kind: "wide" }],
    [`${face}w`, { face, kind: "wide" }],
  ])),
  M: { face: "L", kind: "slice" }, E: { face: "D", kind: "slice" }, S: { face: "F", kind: "slice" },
  x: { face: "R", kind: "rotation" }, y: { face: "U", kind: "rotation" }, z: { face: "F", kind: "rotation" },
};

function guideLayers(kind: GuideKind, side: number): readonly [number, number] {
  if (kind === "rotation") return [-1, 1];
  if (kind === "slice") return [-1 / 3, 1 / 3];
  const inner = kind === "wide" ? -1 / 3 : 1 / 3;
  return side === 1 ? [inner, 1] : [-1, -inner];
}

/** cubing.js owns single-token notation parsing, including wide turns. */
export function moveGuideForToken(token: string, orientation: Orientation = IDENTITY): MoveGuide | null {
  try {
    const move = new Move(token);
    const family = GUIDE_FAMILIES[move.quantum.family];
    const turns = ((move.amount % 4) + 4) % 4;
    if (!turns || !family || move.quantum.toString() !== move.quantum.family) return null;
    const { face, kind } = family;
    const { axis, side } = GUIDE_FACES[orientation[face]];
    const layers = guideLayers(kind, side);
    return { token, kind, axis, layers, direction: (turns === 3 ? side : -side) as -1 | 1, halfTurn: turns === 2 };
  } catch {
    return null;
  }
}
