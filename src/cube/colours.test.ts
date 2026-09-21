import { describe, expect, it } from "vitest";
import { FACE_COLOURS, faceOfColour, slotColours } from "./colours";
import { OPPOSITE, FACES } from "./moves";

describe("face colours", () => {
  it("uses the standard scheme", () => {
    expect(FACE_COLOURS.U.name).toBe("white");
    expect(FACE_COLOURS.F.name).toBe("green");
    expect(FACE_COLOURS.R.name).toBe("red");
  });

  it("puts each colour opposite the right one", () => {
    expect(FACE_COLOURS[OPPOSITE.U].name).toBe("yellow");
    expect(FACE_COLOURS[OPPOSITE.F].name).toBe("blue");
    expect(FACE_COLOURS[OPPOSITE.R].name).toBe("orange");
  });

  it("round-trips a colour back to its face", () => {
    for (const face of FACES) {
      expect(faceOfColour(FACE_COLOURS[face].name)).toBe(face);
    }
    expect(faceOfColour("puce")).toBeNull();
  });
});

describe("slotColours", () => {
  it("names a slot by the two colours that meet there", () => {
    expect(slotColours("FR")).toBe("green-red");
    expect(slotColours("FL")).toBe("green-orange");
    expect(slotColours("BL")).toBe("blue-orange");
    expect(slotColours("BR")).toBe("blue-red");
  });

  it("works for slots beside a cross on any face", () => {
    expect(slotColours("UR")).toBe("white-red");
    expect(slotColours("DL")).toBe("yellow-orange");
  });

  it("refuses anything that is not a pair of faces", () => {
    expect(slotColours("FRU")).toBeNull();
    expect(slotColours("XY")).toBeNull();
  });
});
