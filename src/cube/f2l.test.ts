import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import type { KPattern } from "cubing/kpuzzle";
import { F2L_SLOTS, f2lTable, planF2l } from "./f2l";
import { F2L_CASES } from "./f2lCases";
import { EDGES_OF_FACE, FACES, f2lSlotsForCrossFace } from "./moves";
import { frontsFor, rotationForGrip, slotInCubeFrame } from "./orientation";
import { get3x3x3 } from "./puzzle";
import { reframe } from "./recognise";

const kpuzzle = await get3x3x3();
const table = f2lTable(kpuzzle);

/** Algorithms may leave the cube rotated; put the centres back before reading it. */
function centresHome(pattern: KPattern): KPattern {
  const solved = kpuzzle.defaultPattern().patternData.CENTERS.pieces;
  const home = (candidate: KPattern) =>
    candidate.patternData.CENTERS.pieces.every((piece, i) => piece === solved[i]);
  if (home(pattern)) return pattern;
  for (const x of ["", "x", "x2", "x'", "z", "z'"]) {
    for (const y of ["", "y", "y2", "y'"]) {
      const candidate = pattern.applyAlg(new Alg(`${x} ${y}`.trim()));
      if (home(candidate)) return candidate;
    }
  }
  throw new Error("no rotation puts the centres back");
}

const slotSolved = (pattern: KPattern, index: number) => {
  const { CORNERS, EDGES } = pattern.patternData;
  const slot = F2L_SLOTS[index];
  return (
    CORNERS.pieces[slot.corner] === slot.corner &&
    CORNERS.orientation[slot.corner] === 0 &&
    EDGES.pieces[slot.edge] === slot.edge &&
    EDGES.orientation[slot.edge] === 0
  );
};

const crossDone = (pattern: KPattern) =>
  EDGES_OF_FACE.D.every(
    (slot) =>
      pattern.patternData.EDGES.pieces[slot] === slot &&
      pattern.patternData.EDGES.orientation[slot] === 0,
  );

const after = (pattern: KPattern, moves: readonly string[]) =>
  centresHome(pattern.applyAlg(new Alg(moves.join(" "))));

const randomScramble = () =>
  Array.from({ length: 20 }, () => {
    const suffix = ["", "'", "2"];
    return (
      "URFDLB"[Math.floor(Math.random() * 6)] +
      suffix[Math.floor(Math.random() * 3)]
    );
  }).join(" ");

describe("the case table", () => {
  it("knows every way a pair can stand", () => {
    // A corner in the last layer or its own slot, three ways round; an edge likewise,
    // two ways round. That is 150 states, of which one is the solved pair.
    const missing: string[] = [];
    for (const corner of [0, 1, 2, 3, F2L_SLOTS[0].corner]) {
      for (let twist = 0; twist < 3; twist++) {
        for (const edge of [0, 1, 2, 3, F2L_SLOTS[0].edge]) {
          for (let flip = 0; flip < 2; flip++) {
            const key = `${corner}.${twist}|${edge}.${flip}`;
            if (key === `${F2L_SLOTS[0].corner}.0|${F2L_SLOTS[0].edge}.0`) continue;
            if (!table.has(key)) missing.push(key);
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(table.size).toBe(149);
  });

  it("gives each of the 41 cases its own states", () => {
    expect(F2L_CASES).toHaveLength(41);
    expect(new Set([...table.values()].map((entry) => entry.name)).size).toBe(41);
  });
});

describe("planF2l", () => {
  it("names each case and solves it, in every slot and under every AUF", () => {
    for (const [index, f2lCase] of F2L_CASES.entries()) {
      // The setups are written for the front-right slot; rotating the cube puts the
      // same case in each of the others.
      const base = kpuzzle.defaultPattern().applyAlg(new Alg(f2lCase.setup));
      for (let slot = 0; slot < F2L_SLOTS.length; slot++) {
        const placed = reframe(kpuzzle, base, new Alg("y ".repeat(slot)));
        for (const auf of ["", "U", "U2", "U'"]) {
          const where = `${f2lCase.name} in ${F2L_SLOTS[slot].name} after "${auf}"`;
          const pattern = placed.applyAlg(new Alg(auf));
          const plan = planF2l(kpuzzle, pattern)[slot];
          expect(plan.status, where).toBe("case");
          expect(plan.solution?.name, where).toBe(f2lCase.name);
          // The other slots and the cross were solved, and must still be afterwards.
          const done = after(pattern, plan.solution!.moves);
          expect(crossDone(done), where).toBe(true);
          for (let other = 0; other < F2L_SLOTS.length; other++) {
            expect(slotSolved(done, other), `${where}, slot ${other}`).toBe(true);
          }
        }
      }
      // Cheap sanity that the loop is doing what it looks like.
      if (index === 0) expect(f2lCase.name).toBe("F2L 1");
    }
  });

  it("writes each solution as one sequence, not three stuck together", () => {
    for (const f2lCase of F2L_CASES) {
      const base = kpuzzle.defaultPattern().applyAlg(new Alg(f2lCase.setup));
      for (let slot = 0; slot < F2L_SLOTS.length; slot++) {
        const placed = reframe(kpuzzle, base, new Alg("y ".repeat(slot)));
        for (const auf of ["", "U", "U2", "U'"]) {
          const moves = planF2l(kpuzzle, placed.applyAlg(new Alg(auf)))[slot].solution!
            .moves;
          // No `U' U` left at the join between lining the layer up and the algorithm.
          const families = moves.map((move) => move[0]);
          const stutter = families.findIndex((face, i) => i > 0 && face === families[i - 1]);
          expect(stutter, `${f2lCase.name} after "${auf}": ${moves.join(" ")}`).toBe(-1);
        }
      }
    }
  });

  it("calls a solved slot solved, and nothing else", () => {
    const plans = planF2l(kpuzzle, kpuzzle.defaultPattern());
    expect(plans.map((plan) => plan.status)).toEqual([
      "solved",
      "solved",
      "solved",
      "solved",
    ]);
  });

  it("names each slot by the faces it really has, in every grip", () => {
    // The slots are read off a cube turned cross-face down, so their names are
    // positions in the hand. Translated back they must name the slot on the real
    // cube whose pieces they were talking about.
    for (const bottom of FACES) {
      for (const front of frontsFor(bottom)) {
        const grip = rotationForGrip(bottom, front)!;
        const rotation = new Alg(grip.tokens.join(" "));
        const cube = kpuzzle.defaultPattern().applyAlg(new Alg(randomScramble()));
        const held = reframe(kpuzzle, cube, rotation);
        const slots = f2lSlotsForCrossFace(bottom);
        for (const plan of planF2l(kpuzzle, held)) {
          const named = slotInCubeFrame(grip.orientation, plan.name);
          const index = slots.findIndex((slot) => slot.name === named);
          const where = `${bottom} down, ${front} front: ${plan.name} -> ${named}`;
          expect(index, where).toBeGreaterThanOrEqual(0);
          if (plan.status === "buried") continue;
          // What the cube really looks like afterwards, back in its own frame.
          const done = reframe(
            kpuzzle,
            after(held, plan.solution?.moves ?? []),
            rotation.invert(),
          );
          const { CORNERS, EDGES } = done.patternData;
          const slot = slots[index];
          expect(CORNERS.pieces[slot.corner] === slot.corner, where).toBe(true);
          expect(CORNERS.orientation[slot.corner] === 0, where).toBe(true);
          expect(EDGES.pieces[slot.edge] === slot.edge, where).toBe(true);
          expect(EDGES.orientation[slot.edge] === 0, where).toBe(true);
        }
      }
    }
  });

  it("reads any cube at all, and the moves it prints do what they say", () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const scramble = randomScramble();
      const pattern = kpuzzle.defaultPattern().applyAlg(new Alg(scramble));
      for (const [index, plan] of planF2l(kpuzzle, pattern).entries()) {
        const where = `${scramble} / ${plan.name}`;
        if (plan.status === "solved") {
          expect(slotSolved(pattern, index), where).toBe(true);
          continue;
        }
        if (plan.status === "buried") {
          expect(slotSolved(pattern, index), where).toBe(false);
          continue;
        }
        // A case's algorithm depends only on where its two pieces are, so it puts
        // them home whatever the rest of the cube is doing.
        expect(slotSolved(after(pattern, plan.solution!.moves), index), where).toBe(
          true,
        );
      }
    }
  });
});
