import { describe, expect, it } from "vitest";
import {
  activeRecordedMoveIndices,
  canPracticeF2lStep,
  formatScaleSeconds,
  stepAt,
  stepBarWidths,
  stepTimeScale,
} from "./StepBreakdown";
import type { SolveStep } from "../cube/analysis";
import type { ReplayAction } from "./replayTimeline";

/** Cross 0-8, a skipped pair, then three pairs, OLL and PLL. */
const steps = [
  { name: "Cross", fromMove: 0, toMove: 8 },
  { name: "F2L Slot 1", fromMove: 8, toMove: 8 },
  { name: "F2L Slot 2", fromMove: 8, toMove: 16 },
  { name: "F2L Slot 3", fromMove: 16, toMove: 22 },
  { name: "F2L Slot 4", fromMove: 22, toMove: 30 },
  { name: "OLL", fromMove: 30, toMove: 39 },
  { name: "PLL", fromMove: 39, toMove: 52 },
] as SolveStep[];

const nameAt = (index: number) => steps[stepAt(steps, index)].name;

describe("stepAt", () => {
  it("starts in the first step", () => {
    expect(nameAt(0)).toBe("Cross");
    expect(nameAt(7)).toBe("Cross");
  });

  it("moves on the moment a step's first move is reached", () => {
    // Landing on move 8 means the cross is done and the next pair is about to start.
    expect(nameAt(8)).toBe("F2L Slot 2");
    expect(nameAt(16)).toBe("F2L Slot 3");
    expect(nameAt(30)).toBe("OLL");
    expect(nameAt(39)).toBe("PLL");
  });

  it("never lands on a step that was skipped", () => {
    expect(nameAt(8)).not.toBe("F2L Slot 1");
  });

  it("stays on the last step once the solve is over", () => {
    expect(nameAt(52)).toBe("PLL");
    expect(nameAt(99)).toBe("PLL");
  });
});

describe("canPracticeF2lStep", () => {
  const base = {
    slot: "FR",
    skipped: false,
    fromMove: 4,
    toMove: 9,
  } as SolveStep;

  it("accepts only non-skipped F2L rows with a usable boundary", () => {
    expect(canPracticeF2lStep({ ...base, name: "F2L Slot 1" })).toBe(true);
    expect(canPracticeF2lStep({ ...base, name: "Cross" })).toBe(false);
    expect(canPracticeF2lStep({ ...base, name: "F2L Slot 2", skipped: true })).toBe(false);
    expect(canPracticeF2lStep({ ...base, name: "F2L Slot 3", slot: null })).toBe(false);
    expect(canPracticeF2lStep({ ...base, name: "F2L Slot 4", toMove: 4 })).toBe(false);
  });
});

describe("activeRecordedMoveIndices", () => {
  const step = (recordedMoves: SolveStep["recordedMoves"]) => ({
    fromMove: 10,
    toMove: 12,
    recordedMoves,
  }) as SolveStep;
  const action = (overrides: Partial<ReplayAction>): ReplayAction => ({
    move: "R",
    rawIndex: 10,
    rawTimeMs: 100,
    playbackTimeMs: 100,
    completesRawMove: true,
    source: "raw-turn",
    ...overrides,
  });

  it("maps an exact raw timestamp to the displayed move", () => {
    expect(
      activeRecordedMoveIndices(
        step([
          { move: "R", t: 100 },
          { move: "U", t: 180 },
        ]),
        action({ rawTimeMs: 180 }),
      ),
    ).toEqual([1]);
  });

  it("maps both raw turns in a merged move to that displayed move", () => {
    const displayed = step([{ move: "U2", t: 180 }]);
    expect(activeRecordedMoveIndices(displayed, action({ rawTimeMs: 100 }))).toEqual([0]);
    expect(activeRecordedMoveIndices(displayed, action({ rawIndex: 11, rawTimeMs: 180 }))).toEqual([0]);
  });

  it("maps a rotation and raw turn at one timestamp to separate entries", () => {
    const displayed = step([
      { move: "y", t: 300 },
      { move: "R", t: 300 },
    ]);
    expect(
      activeRecordedMoveIndices(
        displayed,
        action({ move: "y", rawTimeMs: 300, completesRawMove: false, source: "grip-rotation", rotationOrdinal: 0 }),
      ),
    ).toEqual([0]);
    expect(activeRecordedMoveIndices(
      displayed,
      action({ rawTimeMs: 300 }),
    )).toEqual([1]);
  });

  it("does not map a raw move outside the step range", () => {
    const displayed = step([{ move: "R", t: 100 }]);
    expect(activeRecordedMoveIndices(displayed, action({ rawIndex: 9 }))).toEqual([]);
    expect(activeRecordedMoveIndices(displayed, action({ rawIndex: 12 }))).toEqual([]);
  });
});

function timedSteps(...times: number[]): SolveStep[] {
  return times.map((timeMs, index) => ({
    name: `Step ${index}`,
    timeMs,
    recognitionMs: 0,
    executionMs: timeMs,
  })) as unknown as SolveStep[];
}

describe("stepTimeScale", () => {
  it("chooses a five-division scale for a typical solve", () => {
    expect(stepTimeScale(timedSteps(1200, 2340))).toEqual({
      tickMs: 500,
      maxMs: 2500,
      ticks: [500, 1000, 1500, 2000, 2500],
    });
  });

  it("uses finer divisions for fast steps", () => {
    expect(stepTimeScale(timedSteps(760))).toEqual({
      tickMs: 200,
      maxMs: 800,
      ticks: [200, 400, 600, 800],
    });
  });

  it("rounds a just-over-one-second step to a quarter-second tick", () => {
    expect(stepTimeScale(timedSteps(1180))).toMatchObject({
      tickMs: 250,
      maxMs: 1250,
    });
  });

  it("expands for slow steps without excessive guides", () => {
    expect(stepTimeScale(timedSteps(6800))).toMatchObject({
      tickMs: 1000,
      maxMs: 7000,
    });
  });

  it("ignores zero-duration steps and handles an all-zero solve", () => {
    expect(stepTimeScale(timedSteps(0, 2340))).toEqual(stepTimeScale(timedSteps(2340)));
    expect(stepTimeScale(timedSteps(0))).toEqual({
      tickMs: 100,
      maxMs: 500,
      ticks: [100, 200, 300, 400, 500],
    });
  });

  it("does not fill recognition or execution for a zero-duration step", () => {
    const scale = stepTimeScale(timedSteps(0, 2340));
    expect(stepBarWidths(timedSteps(0)[0], 2340, scale)).toEqual({
      recognitionWidth: 0,
      executionWidth: 0,
    });
  });

  it("keeps skipped steps visually empty even with stored timing", () => {
    const scale = stepTimeScale(timedSteps(2340));
    const skipped = { ...timedSteps(2340)[0], skipped: true };
    expect(stepBarWidths(skipped, 2340, scale)).toEqual({
      recognitionWidth: 0,
      executionWidth: 0,
    });
  });

  it("scales recognition and execution against the shared maximum", () => {
    const scale = { tickMs: 500, maxMs: 2500, ticks: [500, 1000, 1500, 2000, 2500] };
    const step = {
      name: "F2L Slot 1",
      timeMs: 2000,
      recognitionMs: 500,
      executionMs: 1500,
    } as unknown as SolveStep;

    const widths = stepBarWidths(step, 2000, scale);
    expect(widths).toEqual({ recognitionWidth: 20, executionWidth: 60 });
    expect(widths.recognitionWidth + widths.executionWidth).toBe(80);
  });
});

describe("formatScaleSeconds", () => {
  it.each([
    [500, "0.5s"],
    [1000, "1s"],
    [1500, "1.5s"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatScaleSeconds(ms)).toBe(expected);
  });
});
