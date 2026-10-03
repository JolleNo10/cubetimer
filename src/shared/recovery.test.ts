import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../cube/puzzle";
import { ScrambleTracker } from "../cube/scramble";
import * as solver from "../cube/solver";
import { calculateRecovery } from "./recovery";

const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());
describe("raw scramble recovery", () => {
  it.each([
    ["R'", "U F", 1],
    ["R U", "F'", 3],
    ["R'", "U'", 1],
  ])("chooses the shorter path, preferring last known on a tie", async (back, end, resumeAt) => {
    const tracker = new ScrambleTracker(kpuzzle, "R U F");
    tracker.update(kpuzzle.defaultPattern().applyAlg("R"));
    const current = kpuzzle.defaultPattern().applyAlg("R B");
    const between = vi.spyOn(solver, "algBetween")
      .mockResolvedValueOnce(new Alg(back as string)).mockResolvedValueOnce(new Alg(end as string));
    expect(await calculateRecovery(current, tracker)).toEqual({ alg: resumeAt === 1 ? back : end, resumeAt });
    expect(between).toHaveBeenNthCalledWith(1, current, tracker.lastKnownPattern);
    expect(between).toHaveBeenNthCalledWith(2, current, tracker.targetPattern);
  });
});
