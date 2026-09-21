import { describe, expect, it } from "vitest";
import { f2lSlotsForCrossFace, parseFaceMove } from "./moves";

describe("parseFaceMove", () => {
  it("reads every notation a cube or cubing.js can produce", () => {
    expect(parseFaceMove("R")).toEqual({ face: "R", amount: 1 });
    expect(parseFaceMove("R'")).toEqual({ face: "R", amount: -1 });
    expect(parseFaceMove("U2")).toEqual({ face: "U", amount: 2 });
    expect(parseFaceMove("B2'")).toEqual({ face: "B", amount: 2 });
    expect(parseFaceMove(" F ")).toEqual({ face: "F", amount: 1 });
  });

  it("rejects anything that is not a face turn", () => {
    expect(parseFaceMove("Rw")).toBeNull();
    expect(parseFaceMove("x")).toBeNull();
    expect(parseFaceMove("R3")).toBeNull();
    expect(parseFaceMove("")).toBeNull();
  });
});

describe("f2lSlotsForCrossFace", () => {
  it("pairs each corner with the edge of its slot", () => {
    const slots = f2lSlotsForCrossFace("D");
    expect(slots.map((s) => s.name).sort()).toEqual(["BL", "BR", "FL", "FR"]);
  });

  it("works for a cross on any face", () => {
    for (const face of ["U", "R", "F", "D", "L", "B"] as const) {
      const slots = f2lSlotsForCrossFace(face);
      expect(slots).toHaveLength(4);
      expect(new Set(slots.map((s) => s.edge)).size).toBe(4);
    }
  });
});
