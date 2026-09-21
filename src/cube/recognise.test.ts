import { describe, expect, it } from "vitest";
import { Alg } from "cubing/alg";
import {
  OLL_ALGORITHMS,
  OLL_GROUPS,
  PLL_ALGORITHMS,
  ollGroupForCase,
} from "./lastLayerCases";
import {
  lastLayerCornersOriented,
  lastLayerEdges,
  lastLayerTables,
  recogniseOll,
  recognisePll,
} from "./recognise";
import { get3x3x3 } from "./puzzle";

const kpuzzle = await get3x3x3();
const tables = lastLayerTables(kpuzzle);

describe("case tables", () => {
  it("accepts every algorithm as a real last-layer case", () => {
    expect(tables.oll.rejected).toEqual([]);
    expect(tables.pll.rejected).toEqual([]);
    expect(Object.keys(OLL_ALGORITHMS)).toHaveLength(57);
    expect(Object.keys(PLL_ALGORITHMS)).toHaveLength(21);
  });

  it("gives every case a distinct set of states", () => {
    // If two cases shared a state the table would be ambiguous and recognition a lie.
    expect(new Set(tables.oll.byKey.values()).size).toBe(57);
    // The 21 cases plus "Solved", for a last layer that only needs lining up.
    expect(new Set(tables.pll.byKey.values()).size).toBe(22);
  });
});

describe("recogniseOll", () => {
  it("names the case each algorithm solves", () => {
    for (const [number, algorithm] of Object.entries(OLL_ALGORITHMS)) {
      const state = kpuzzle.defaultPattern().applyAlg(new Alg(algorithm).invert());
      expect(recogniseOll(kpuzzle, state), `OLL ${number}`).toBe(number);
    }
  });

  it("names it the same whatever the AUF and whichever way the cube faces", () => {
    const sune = kpuzzle
      .defaultPattern()
      .applyAlg(new Alg(OLL_ALGORITHMS[27]).invert());
    for (const setup of ["", "U", "U2", "U'", "y", "y2 U", "y' U2"]) {
      expect(recogniseOll(kpuzzle, sune.applyAlg(new Alg(setup))), setup).toBe("27");
    }
  });

  it("calls an already oriented last layer solved", () => {
    expect(recogniseOll(kpuzzle, kpuzzle.defaultPattern())).toBe("Solved");
    // Permutation does not matter to OLL: a cube needing only a PLL is oriented.
    const pllOnly = kpuzzle.defaultPattern().applyAlg(new Alg(PLL_ALGORITHMS.T).invert());
    expect(recogniseOll(kpuzzle, pllOnly)).toBe("Solved");
  });
});

describe("recognisePll", () => {
  it("names the case each algorithm solves", () => {
    for (const [name, algorithm] of Object.entries(PLL_ALGORITHMS)) {
      const state = kpuzzle.defaultPattern().applyAlg(new Alg(algorithm).invert());
      expect(recognisePll(kpuzzle, state), name).toBe(name);
    }
  });

  it("names it the same whatever the AUF and whichever way the cube faces", () => {
    const tperm = kpuzzle.defaultPattern().applyAlg(new Alg(PLL_ALGORITHMS.T).invert());
    for (const setup of ["", "U", "U2", "U'", "y", "y2 U'", "y' U"]) {
      expect(recognisePll(kpuzzle, tperm.applyAlg(new Alg(setup))), setup).toBe("T");
    }
  });

  it("calls a finished last layer solved, and refuses an unoriented one", () => {
    expect(recognisePll(kpuzzle, kpuzzle.defaultPattern())).toBe("Solved");
    expect(recognisePll(kpuzzle, kpuzzle.defaultPattern().applyAlg(new Alg("U")))).toBe(
      "Solved",
    );
    const ollOnly = kpuzzle.defaultPattern().applyAlg(new Alg(OLL_ALGORITHMS[27]).invert());
    expect(recognisePll(kpuzzle, ollOnly)).toBeNull();
  });
});

const caseState = (algorithm: string) =>
  kpuzzle.defaultPattern().applyAlg(new Alg(algorithm).invert());

describe("OLL shape groups", () => {
  it("puts every case in exactly one group", () => {
    const all = Object.values(OLL_GROUPS).flat();
    expect(all).toHaveLength(57);
    expect(new Set(all).size).toBe(57);
    for (let n = 1; n <= 57; n++) {
      expect(ollGroupForCase(String(n)), `OLL ${n}`).not.toBeNull();
    }
  });

  /**
   * Most group names describe what the case looks like and cannot be checked against
   * anything. Four of them are statements about the cube, and those must hold.
   */
  it("agrees with the cube wherever a group has a computable meaning", () => {
    const groupOf = (n: number) => ollGroupForCase(String(n))!;
    for (const [number, algorithm] of Object.entries(OLL_ALGORITHMS)) {
      const state = caseState(algorithm);
      const edges = lastLayerEdges(state);
      const group = groupOf(Number(number));

      // A dot case is one with no last-layer edge pointing up, and vice versa.
      expect(edges === "dot", `OLL ${number} (${group})`).toBe(group === "dot");
      // OCLL is the set with all four edges already up.
      expect(edges === "cross", `OLL ${number} (${group})`).toBe(group === "OCLL");
      // An L needs two edges up side by side; a line needs them facing each other.
      if (group === "L") expect(edges, `OLL ${number}`).toBe("adjacent");
      if (group === "line") expect(edges, `OLL ${number}`).toBe("opposite");
      // And the two cases named for their corners are the ones with corners done.
      if (group === "corners oriented") {
        expect(lastLayerCornersOriented(state), `OLL ${number}`).toBe(true);
      }
    }
  });

  it("names the group of the example that was wrong before", () => {
    // OLL 42 is an awkward shape. It has two adjacent edges up, which is why a
    // classification by edge arrangement alone mislabelled it an "L shape".
    expect(ollGroupForCase("42")).toBe("awkward");
    expect(lastLayerEdges(caseState(OLL_ALGORITHMS[42]))).toBe("adjacent");
    expect(ollGroupForCase("47")).toBe("L");
    expect(ollGroupForCase("55")).toBe("line");
    expect(ollGroupForCase("27")).toBe("OCLL");
    expect(ollGroupForCase("9")).toBe("fish");
  });
});
