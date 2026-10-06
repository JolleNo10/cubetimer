/**
 * What a smart cube reports when someone turns an algorithm.
 *
 * The cube only sees its own six faces turning against fixed centres. A wide move, a
 * slice or a rotation is therefore reported as plain face turns plus a change in how
 * the cube is being held — `r` arrives as `L`, and every move after it is written one
 * `x` further round. Comparing what was recorded with a catalogue algorithm, or playing
 * an algorithm on a cube that is tracked by its centres, needs the algorithm in that
 * form.
 */
import { Alg } from "cubing/alg";
import { compose, GENERATORS, IDENTITY, invert, type Orientation } from "./orientation";
import { formatMove } from "./notation";
import type { Face } from "./moves";

type Axis = "x" | "y" | "z";

/** A wide move or slice as the face turn the cube sees, and the rotation it implies. */
const EQUIVALENTS: Record<string, { turns: [Face, number][]; axis: Axis; sign: number }> = {
  r: { turns: [["L", 1]], axis: "x", sign: 1 },
  l: { turns: [["R", 1]], axis: "x", sign: -1 },
  u: { turns: [["D", 1]], axis: "y", sign: 1 },
  d: { turns: [["U", 1]], axis: "y", sign: -1 },
  f: { turns: [["B", 1]], axis: "z", sign: 1 },
  b: { turns: [["F", 1]], axis: "z", sign: -1 },
  M: { turns: [["R", 1], ["L", -1]], axis: "x", sign: -1 },
  E: { turns: [["U", 1], ["D", -1]], axis: "y", sign: -1 },
  S: { turns: [["F", -1], ["B", 1]], axis: "z", sign: 1 },
};

function rotate(grip: Orientation, axis: Axis, amount: number): Orientation {
  let result = grip;
  for (let i = 0; i < ((amount % 4) + 4) % 4; i++) result = compose(result, GENERATORS[axis]);
  return result;
}

const TOKEN = /^([URFDLBMESxyzrludfb])(w?)(\d*)('?)$/;

/** One token, with `Rw` read as `r`. Amounts are signed quarter turns. */
function parse(token: string): { family: string; amount: number } | null {
  const match = TOKEN.exec(token.trim());
  if (!match) return null;
  const family = match[2] ? match[1].toLowerCase() : match[1];
  const magnitude = match[3] ? Number(match[3]) : 1;
  return { family, amount: match[4] === "'" ? -magnitude : magnitude };
}

function normalise(amount: number): number {
  const quarter = ((amount % 4) + 4) % 4;
  return quarter === 3 ? -1 : quarter;
}

/**
 * Rewrite a held-frame algorithm as cube-frame face turns.
 *
 * `grip` maps each face of the cube to where it is held (the `Orientation` convention
 * used by `reorientMove`). The grip the algorithm finishes in is returned with the
 * turns, so a caller can keep going from there.
 */
export function physicalTurns(
  algorithm: string,
  grip: Orientation = IDENTITY,
): { moves: string[]; grip: Orientation } {
  const moves: string[] = [];
  let held = grip;
  for (const node of new Alg(algorithm).expand().childAlgNodes()) {
    const parsed = parse(node.toString());
    if (!parsed) continue;
    const { family, amount } = parsed;
    if (family === "x" || family === "y" || family === "z") {
      held = rotate(held, family, amount);
      continue;
    }
    const equivalent = EQUIVALENTS[family];
    const toCube = invert(held);
    if (!equivalent) {
      const turned = normalise(amount);
      if (turned !== 0) moves.push(formatMove({ family: toCube[family as Face], amount: turned }));
      continue;
    }
    for (const [face, direction] of equivalent.turns) {
      const turned = normalise(direction * amount);
      if (turned !== 0) moves.push(formatMove({ family: toCube[face], amount: turned }));
    }
    held = rotate(held, equivalent.axis, equivalent.sign * amount);
  }
  return { moves, grip: held };
}
