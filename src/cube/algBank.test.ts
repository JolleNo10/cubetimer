import { describe, expect, it } from "vitest";
import {
  F2L_SLOTS,
  f2lAlgSolves,
  isF2lSolved,
  ollCaseSolvedBy,
  pllCaseSolvedBy,
} from "./algBank";
import {
  ALG_BANK_SOURCE,
  F2L_ALG_BANK,
  OLL_ALG_BANK,
  PLL_ALG_BANK,
} from "./algBank.generated";
import { OLL_ALGORITHMS, PLL_ALGORITHMS } from "./lastLayerCases";
import { F2L_CASES } from "./f2lCases";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();

/** The rotation that presents each case in each slot, as the builder worked it out. */
const SLOT_TURNS: Record<string, number> = { FR: 0, FL: 3, BL: 2, BR: 1 };

describe("the bank covers every case", () => {
  it("has algorithms for all 57 OLLs", () => {
    for (const number of Object.keys(OLL_ALGORITHMS)) {
      expect(OLL_ALG_BANK[number], `OLL ${number}`).toBeTruthy();
      expect(OLL_ALG_BANK[number].length, `OLL ${number}`).toBeGreaterThan(0);
    }
  });

  it("has algorithms for all 21 PLLs", () => {
    for (const name of Object.keys(PLL_ALGORITHMS)) {
      expect(PLL_ALG_BANK[name], name).toBeTruthy();
      expect(PLL_ALG_BANK[name].length, name).toBeGreaterThan(0);
    }
  });

  it("has algorithms for all 41 F2L cases, in all four slots", () => {
    for (const { name } of F2L_CASES) {
      const slots = F2L_ALG_BANK[name];
      expect(slots, name).toBeTruthy();
      for (const slot of F2L_SLOTS) {
        expect(slots[slot]?.length, `${name} ${slot}`).toBeGreaterThan(0);
      }
    }
  });

  it("is big enough to be worth having, and says where it came from", () => {
    expect(ALG_BANK_SOURCE.algorithms).toBeGreaterThan(900);
    expect(ALG_BANK_SOURCE.url).toContain("speedcubedb");
  });
});

/**
 * The same checks the builder ran, over what was actually committed.
 *
 * A scrape is only as good as the page it read, and the page can change shape without
 * warning. Running the checks again here means a bad re-scrape fails the build rather
 * than quietly teaching the tracker nonsense.
 */
describe("every algorithm in the bank solves the case it is filed under", () => {
  it("OLL", () => {
    for (const [number, algs] of Object.entries(OLL_ALG_BANK)) {
      for (const alg of algs) {
        expect(ollCaseSolvedBy(kpuzzle, alg), `OLL ${number}: ${alg}`).toBe(number);
      }
    }
  });

  it("PLL", () => {
    for (const [name, algs] of Object.entries(PLL_ALG_BANK)) {
      for (const alg of algs) {
        expect(pllCaseSolvedBy(kpuzzle, alg), `${name}: ${alg}`).toBe(name);
      }
    }
  });

  it("F2L", () => {
    for (const [name, slots] of Object.entries(F2L_ALG_BANK)) {
      for (const [slot, algs] of Object.entries(slots)) {
        for (const alg of algs ?? []) {
          expect(
            f2lAlgSolves(kpuzzle, name, SLOT_TURNS[slot], alg),
            `${name} ${slot}: ${alg}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("the checks themselves", () => {
  it("knows a solved first two layers from a broken one", () => {
    expect(isF2lSolved(kpuzzle.defaultPattern())).toBe(true);
    // A U turn only moves the last layer, so the first two are still in.
    expect(isF2lSolved(kpuzzle.defaultPattern().applyMove("U"))).toBe(true);
    expect(isF2lSolved(kpuzzle.defaultPattern().applyMove("R"))).toBe(false);
  });

  it("turns down an algorithm that is not for the case", () => {
    // A T perm is a fine algorithm, but it is not the Y perm.
    expect(pllCaseSolvedBy(kpuzzle, PLL_ALGORITHMS.T)).toBe("T");
    expect(pllCaseSolvedBy(kpuzzle, PLL_ALGORITHMS.T)).not.toBe("Y");
  });

  it("turns down something that is not a last-layer algorithm at all", () => {
    expect(ollCaseSolvedBy(kpuzzle, "R U F")).toBeNull();
    expect(pllCaseSolvedBy(kpuzzle, "R U F")).toBeNull();
  });

  it("turns down nonsense notation without throwing", () => {
    expect(ollCaseSolvedBy(kpuzzle, "not an alg")).toBeNull();
    expect(f2lAlgSolves(kpuzzle, "F2L 1", 0, "not an alg")).toBe(false);
    expect(f2lAlgSolves(kpuzzle, "no such case", 0, "U R U' R'")).toBe(false);
  });

  it("agrees with the primary algorithms the recogniser already trusts", () => {
    for (const [number, alg] of Object.entries(OLL_ALGORITHMS)) {
      expect(ollCaseSolvedBy(kpuzzle, alg), `OLL ${number}`).toBe(number);
    }
    for (const [name, alg] of Object.entries(PLL_ALGORITHMS)) {
      expect(pllCaseSolvedBy(kpuzzle, alg), name).toBe(name);
    }
  });
});
