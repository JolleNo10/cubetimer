import { describe, expect, it } from "vitest";
import type { TimedMove } from "../../../cube/notation";
import {
  buildReplayTimeline,
  rawPositionAtReplayIndex,
  replayIndexForRawPosition,
} from "./replayTimeline";

const moves = (...times: number[]): TimedMove[] =>
  times.map((t, rawIndex) => ({ move: `M${rawIndex}`, t }));

describe("buildReplayTimeline", () => {
  it("keeps plain raw moves as separate replay actions", () => {
    expect(buildReplayTimeline([["R"], ["U"]], moves(100, 180))).toMatchObject([
      {
        move: "R",
        rawIndex: 0,
        rawTimeMs: 100,
        playbackTimeMs: 100,
        completesRawMove: true,
        source: "raw-turn",
      },
      {
        move: "U",
        rawIndex: 1,
        rawTimeMs: 180,
        playbackTimeMs: 180,
        completesRawMove: true,
        source: "raw-turn",
      },
    ]);
  });

  it("splits an inserted rotation from its raw turn", () => {
    const actions = buildReplayTimeline([["U"], ["y", "R"]], moves(1000, 1200));
    expect(actions.slice(1)).toMatchObject([
      {
        move: "y",
        rawIndex: 1,
        rawTimeMs: 1200,
        completesRawMove: false,
        source: "grip-rotation",
        rotationOrdinal: 0,
      },
      {
        move: "R",
        rawIndex: 1,
        rawTimeMs: 1200,
        completesRawMove: true,
        source: "raw-turn",
        playbackTimeMs: 1200,
      },
    ]);
  });

  it("gives several rotations their sequence ordinals", () => {
    expect(buildReplayTimeline([["y", "x", "R"]], moves(300))).toMatchObject([
      { move: "y", rotationOrdinal: 0 },
      { move: "x", rotationOrdinal: 1 },
      { move: "R", source: "raw-turn", completesRawMove: true },
    ]);
  });

  it("interpolates inserted actions while keeping the raw turn at the endpoint", () => {
    const actions = buildReplayTimeline([["U"], ["y", "R"]], moves(1000, 1200));
    expect(actions[1].playbackTimeMs).toBe(1100);
    expect(actions[2].playbackTimeMs).toBe(1200);
  });

  it("falls back to the raw move when expansion is empty", () => {
    expect(buildReplayTimeline([[]], moves(120))).toMatchObject([
      { move: "M0", rawIndex: 0, source: "raw-turn", completesRawMove: true },
    ]);
  });
});

describe("replay cursor projections", () => {
  const actions = buildReplayTimeline(
    [["A"], ["B"], ["C"], ["D"], ["y", "R"]],
    moves(100, 200, 300, 400, 500),
  );

  it("keeps the raw position before an inserted rotation and advances after its turn", () => {
    expect(rawPositionAtReplayIndex(actions, 4)).toBe(4);
    expect(rawPositionAtReplayIndex(actions, 5)).toBe(4);
    expect(rawPositionAtReplayIndex(actions, 6)).toBe(5);
  });

  it("maps a raw phase boundary before every action for its first raw move", () => {
    expect(replayIndexForRawPosition(actions, 4)).toBe(4);
    expect(replayIndexForRawPosition(actions, 5)).toBe(6);
    expect(replayIndexForRawPosition(actions, 99)).toBe(actions.length);
  });
});
