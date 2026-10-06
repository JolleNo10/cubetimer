import { describe, expect, it } from "vitest";
import { dateTicks, segmentBoundaries } from "./chartGeometry";

describe("chart geometry", () => {
  it("finds the index starting each new segment", () => {
    expect(segmentBoundaries(["0", "0", "1", "2", "2"])).toEqual([2, 3]);
    expect(segmentBoundaries([])).toEqual([]);
  });

  it("ticks where the formatted date changes, skipping crowded and repeated labels", () => {
    const label = (at: number) => `day ${Math.floor(at / 10)}`;
    expect(dateTicks([], label)).toEqual([]);
    expect(dateTicks([1, 2, 3], label)).toEqual([{ index: 0, label: "day 0" }]);
    expect(dateTicks([0, 10, 20, 30, 40, 50, 60], label, 3)).toEqual([{ index: 0, label: "day 0" }, { index: 2, label: "day 2" }, { index: 4, label: "day 4" }]);
    const crowded = [0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 99];
    expect(dateTicks(crowded, label, 4).map((tick) => tick.index)).toEqual([0, 11]);
  });
});
