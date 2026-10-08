import { ANALYSIS_VERSION } from "../../../cube/analysis";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolveReviewDialog } from "./SolveReviewDialog";
import { MoveSequence } from "../../../shared/ui/MoveSequence";
import { CubeMoveGuide } from "../../../shared/ui/CubeMoveGuide";
import { CubeFrontMarker } from "../../../shared/ui/CubeFrontMarker";
import { DetailedStepBreakdown } from "./StepBreakdown";
import { SolveReviewPanel } from "./SolveReviewPanel";
import { describeGrip, GENERATORS, IDENTITY, reorientMove, rotationForCrossFace } from "../../../cube/orientation";
import type { Solve } from "../../../app/types";
import type { SolveStep } from "../../../cube/analysis";

// Run the real dialog callbacks/effects against a persistent hook store and a
// player adapter. Cube notation, grip rewriting and timeline projections stay real.
const hooks = vi.hoisted(() => ({
  cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  orbit: null as null | ((value: { latitude: number; longitude: number }) => void),
  player: null as null | { moves: string[]; setup: string; alg: { toString(): string }; experimentalAddMove: ReturnType<typeof vi.fn>; jumpToEnd: ReturnType<typeof vi.fn> },
}));
vi.mock("react", async original => {
  const memo = (make: () => unknown, deps: unknown[]) => {
    const slot = hooks.cursor++;
    const prior = hooks.slots[slot] as { deps: unknown[]; value: unknown } | undefined;
    if (!prior || deps.some((dep, i) => dep !== prior.deps[i])) hooks.slots[slot] = { deps, value: make() };
    return (hooks.slots[slot] as { value: unknown }).value;
  };
  return {
    ...await original<typeof import("react")>(),
    useState: (initial: unknown) => {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = initial;
      return [hooks.slots[slot], (value: unknown) => {
        hooks.slots[slot] = typeof value === "function" ? value(hooks.slots[slot]) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const slot = hooks.cursor++;
      return hooks.slots[slot] ??= { current: initial };
    },
    useContext: () => null,
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    useMemo: memo,
    useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
      memo(() => {
        const slot = hooks.cursor - 1;
        hooks.effects.push(() => {
          hooks.cleanups[slot]?.();
          const cleanup = effect();
          hooks.cleanups[slot] = cleanup ?? (() => {});
        });
      }, deps);
    },
  };
});
vi.mock("cubing/twisty", () => ({ TwistyPlayer: class {
  moves: string[] = [];
  alg = { toString: () => "" };
  experimentalAddMove = vi.fn((move: string) => this.moves.push(move));
  jumpToEnd = vi.fn();
  remove = vi.fn();
  experimentalModel = { twistySceneModel: { orbitCoordinates: {
    addFreshListener: (listener: typeof hooks.orbit) => { hooks.orbit = listener; },
    removeFreshListener: vi.fn(),
  } } };
  setup: string;
  constructor(options?: { experimentalSetupAlg?: { toString(): string } }) {
    this.setup = String(options?.experimentalSetupAlg ?? "");
    hooks.player = this;
  }
} }));

type Node = ReactElement<Record<string, unknown>>;
let keyListener: (event: KeyboardEvent) => void;
let tick: FrameRequestCallback;
let now: number;
class Control {
  isContentEditable = false;
  constructor(private tag: string) {}
  closest(selector: string) { return selector.includes(this.tag) ? this : null; }
}
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.effects = []; hooks.cleanups = []; hooks.player = null; hooks.orbit = null;
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("HTMLElement", Control);
  vi.stubGlobal("window", {
    addEventListener: (_: string, listener: typeof keyListener) => { keyListener = listener; },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { tick = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup?.()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const step = (name: SolveStep["name"], fromMove: number, toMove: number): SolveStep => ({
  name, fromMove, toMove, moves: "R U", recordedMoves: [], skipped: false, hasTurns: true,
  timeMs: 1000, recognitionMs: 200, executionMs: 800, cumulativeMs: 1000, tps: 2,
  case: name === "OLL" ? "27" : null, slot: null, faceTurns: 2, quarterTurns: 2, sliceTurns: 2,
});
const solve: Solve = {
  id: "replay", sessionId: "session", createdAt: 0, rawMs: 1000, penalty: "none",
  source: "smartcube", scramble: "F R", moves: [{ move: "R", t: 100 }, { move: "R", t: 400 }],
  gripTrack: `|${describeGrip(IDENTITY)}${describeGrip(GENERATORS.y)}`,
};

function fixture(initialView?: { index: number; speed: number }, withAnalysis = false, trusted = true, changes: Partial<Solve> = {}, correctionPreview?: React.ComponentProps<typeof SolveReviewDialog>["correctionPreview"]) {
  const onClose = vi.fn(), onTrainStep = vi.fn();
  let selectedSolve: Solve = withAnalysis ? { ...solve, analysis: {
    analysisVersion: ANALYSIS_VERSION, quality: trusted ? { status: "trusted", issues: [] } : { status: "suspect", issues: [{ code: "ambiguous-cross", candidates: ["D", "L"] }] },
    method: "CFOP", crossFace: "D", rotation: "DB", steps: [step("Cross", 0, 1), step("OLL", 1, 2)],
    solvingMs: 1000, tps: 2, totalRecognitionMs: 200, totalExecutionMs: 800, stepsSkipped: 0,
    turnsAfterSolution: 0, pauses: [], faceTurns: 2, quarterTurns: 2, sliceTurns: 2,
  } } : solve;
  Object.assign(selectedSolve, changes);
  function render() {
    hooks.cursor = 0;
    const nodes: Node[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const node = value as Node;
      nodes.push(node);
      if (node.props.className === "replay-cube-host") (node.props.ref as { current: unknown }).current = { appendChild() {} };
      visit(node.props.children);
    };
    visit(SolveReviewDialog({ solve: selectedSolve, onClose, onTrainStep, initialView, correctionPreview }));
    hooks.effects.splice(0).forEach(effect => effect());
    return {
      labels: nodes.filter(node => node.type === "button").map(node => Array.isArray(node.props.children) ? node.props.children.join("") : node.props.children),
      button: (label: string) => nodes.find(node => node.type === "button" &&
      (node.props["aria-label"] === label || (Array.isArray(node.props.children) ? node.props.children.join("") : node.props.children) === label))!.props as { onClick(): void | Promise<void>; disabled?: boolean },
      sequence: nodes.find(node => node.type === MoveSequence)!.props as React.ComponentProps<typeof MoveSequence>,
      arrow: nodes.find(node => node.type === CubeMoveGuide)?.props as React.ComponentProps<typeof CubeMoveGuide> | undefined,
      marker: nodes.find(node => node.type === CubeFrontMarker)!.props as React.ComponentProps<typeof CubeFrontMarker>,
      breakdown: nodes.find(node => node.type === DetailedStepBreakdown)?.props as React.ComponentProps<typeof DetailedStepBreakdown> | undefined,
      panel: nodes.find(node => node.type === SolveReviewPanel)?.props as React.ComponentProps<typeof SolveReviewPanel> | undefined,
      text: () => nodes.flatMap(node => typeof node.props.children === "string" ? [node.props.children] : []),
      input: (label: string) => nodes.find(node => node.props["aria-label"] === label)!.props as { value: number; onChange(event: { target: { value: string } }): void },
    };
  }
  const key = (value: string, target?: Control) => {
    const preventDefault = vi.fn();
    keyListener({ key: value, target, preventDefault } as unknown as KeyboardEvent);
    return preventDefault;
  };
  return { render, key, onClose, onTrainStep, selectedSolve, replaceSolve: (solve: Solve) => { selectedSolve = solve; } };
}

describe("Replay instruction cursor", () => {
  it("clicks action i to pause before it, with the next arrow and last-applied phase action kept distinct", () => {
    const { render } = fixture(undefined, true);
    let view = render();
    expect(view.sequence.moves).toEqual(["R", "y", "F"]);
    expect(view.sequence.tokenKind!(1)).toBe("rotation");
    expect(view.arrow!.move.token).toBe("R");
    view.button("Play").onClick(); render();
    view.sequence.onSelect!(1);
    view = render();
    expect(view.button("Play")).toBeDefined();
    expect(view.input("Move position").value).toBe(1);
    expect(view.sequence.currentIndex).toBe(1);
    expect(view.sequence.completedCount).toBe(1);
    expect(hooks.player!.moves).toEqual(["R"]);
    expect(view.arrow!.move).toMatchObject({ token: "y", kind: "rotation" });
    expect(view.breakdown!.activeReplayAction).toMatchObject({ move: "R", rawIndex: 0, source: "raw-turn" });
    expect(view.breakdown!.activeStep).toBe(1);
    view.sequence.onSelect!(2); view = render();
    expect(view.arrow!.move).toMatchObject({ token: "F", axis: "z", layers: [1 / 3, 1] });
    expect(view.breakdown!.activeReplayAction).toMatchObject({ move: "y", rawIndex: 1, source: "grip-rotation" });
    expect(view.breakdown!.activeStep).toBe(1);
  });

  it("projects the move guide from wherever the camera was dragged", () => {
    const { render } = fixture();
    let view = render();
    expect(view.arrow!.camera).toEqual({ latitude: 27, longitude: 32 });
    hooks.orbit!({ latitude: -10, longitude: 200 });
    view = render();
    expect(view.arrow!.camera).toEqual({ latitude: -10, longitude: 200 });
  });

  it("shows the Front marker only while the camera is being moved", () => {
    vi.useFakeTimers();
    try {
      const { render } = fixture();
      expect(render().marker.visible).toBe(false);
      hooks.orbit!({ latitude: 27, longitude: 32 });
      expect(render().marker.visible).toBe(false);
      hooks.orbit!({ latitude: 20, longitude: 90 });
      let view = render();
      expect(view.marker).toMatchObject({ visible: true, camera: { latitude: 20, longitude: 90 } });
      vi.advanceTimersByTime(1000);
      hooks.orbit!({ latitude: 20, longitude: 120 });
      vi.advanceTimersByTime(1000);
      expect(render().marker.visible).toBe(true);
      vi.advanceTimersByTime(300);
      view = render();
      expect(view.marker.visible).toBe(false);
      expect(view.marker.camera).toEqual({ latitude: 20, longitude: 120 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses start/end and previous/next boundaries, with no arrow at the end", () => {
    const { render } = fixture(); let view = render();
    expect(view.button("Back to start").disabled).toBe(true);
    expect(view.button("Previous move").disabled).toBe(true);
    view.button("Jump to end").onClick(); view = render();
    expect(view.sequence.currentIndex).toBe(3);
    expect(view.sequence.completedCount).toBe(3);
    expect(view.arrow).toBeUndefined();
    expect(view.button("Next move").disabled).toBe(true);
    expect(view.button("Jump to end").disabled).toBe(true);
    view.button("Back to start").onClick(); view = render();
    expect(hooks.player!.alg.toString()).toBe("");
    view.button("Next move").onClick(); view = render();
    expect(view.sequence.currentIndex).toBe(1);
    view.button("Previous move").onClick(); view = render();
    expect(view.sequence.currentIndex).toBe(0);
  });

  it("keeps slider and phase seeking on the same cursor and hands cursor/speed to Training", () => {
    const { render, onTrainStep } = fixture(undefined, true); let view = render();
    view.input("Playback speed").onChange({ target: { value: "0.5" } });
    view.input("Move position").onChange({ target: { value: "2" } }); view = render();
    expect(view.sequence.currentIndex).toBe(2);
    view.breakdown!.onSelectStep!(step("OLL", 1, 2)); view = render();
    expect(view.sequence.currentIndex).toBe(1);
    view.button("Train this OLL").onClick();
    expect(onTrainStep).toHaveBeenCalledWith(expect.objectContaining({ name: "OLL" }), { index: 1, speed: 0.5 });
  });

  it("restores cursor/speed paused, and keeps recorded playback advancing the same instruction", () => {
    const { render } = fixture({ index: 2, speed: 2 }); render(); let view = render();
    expect(view.sequence.currentIndex).toBe(2);
    expect(view.input("Playback speed").value).toBe(2);
    expect(view.arrow!.move.token).toBe("F");
    view.button("Play").onClick(); render(); now = 75; tick(now); view = render();
    expect(view.sequence.currentIndex).toBe(3);
    expect(view.arrow).toBeUndefined();
    expect(view.button("Play")).toBeDefined();
    view.button("Play").onClick(); view = render();
    expect(view.sequence.currentIndex).toBe(0);
  });

  it("uses keyboard cursor controls but leaves form editing and button activation alone", () => {
    const { render, key, onClose } = fixture(); render();
    expect(key("End")).toHaveBeenCalled(); let view = render();
    expect(view.sequence.currentIndex).toBe(3);
    key("Home"); view = render(); expect(view.sequence.currentIndex).toBe(0);
    key(" "); render(); key("ArrowRight"); view = render();
    expect(view.sequence.currentIndex).toBe(1); expect(view.button("Play")).toBeDefined();
    key("ArrowLeft"); view = render(); expect(view.sequence.currentIndex).toBe(0);
    for (const tag of ["input", "select", "textarea"]) {
      for (const value of ["End", "Home", "ArrowRight", " "]) expect(key(value, new Control(tag))).not.toHaveBeenCalled();
    }
    expect(key(" ", new Control("button"))).not.toHaveBeenCalled();
    key("Escape", new Control("input")); expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("state-only correction Review", () => {
  it("filters recorded grip, uses the corrected Cross for Replay, and restores raw Replay after Undo", () => {
    const candidate = { ...fixture(undefined, true).selectedSolve.analysis!, crossFace: "U" as const };
    const { render, selectedSolve, replaceSolve } = fixture(undefined, true, false, {
      solveStartBottomFace: "L", cfopAnalysisCorrection: { mode: "state-only", acceptedAt: 1, analysis: candidate },
    });
    const base = selectedSolve.analysis;
    const track = selectedSolve.gripTrack;
    let view = render();
    const frame = rotationForCrossFace("U");
    expect(view.sequence.moves).toEqual(selectedSolve.moves.map(move => reorientMove(move.move, frame.orientation)));
    expect(hooks.player!.setup).toBe([selectedSolve.scramble, ...frame.tokens].join(" "));
    expect(view.breakdown!.analysis).toBe(candidate);
    expect(view.panel!.solve.gripTrack).toBeUndefined();
    expect(selectedSolve.gripTrack).toBe(track);
    expect(selectedSolve.analysis).toBe(base);
    expect(selectedSolve.solveStartBottomFace).toBe("L");
    const { cfopAnalysisCorrection: _correction, ...undone } = selectedSolve;
    replaceSolve(undone);
    view = render();
    expect(view.sequence.moves).toEqual(["R", "y", "F"]);
    expect(hooks.player!.setup).toBe(selectedSolve.scramble);
    expect(view.breakdown!.analysis).toBe(base);
  });
  it("labels a non-persistent preview, enables trusted alternatives despite manual veto, and Cancels without Apply", () => {
    const candidate = { ...fixture(undefined, true).selectedSolve.analysis!, crossFace: "U" as const };
    const onApply = vi.fn().mockResolvedValue(true);
    const { render, onClose, selectedSolve } = fixture(undefined, true, false, { cfopAnalysisExcluded: true }, { analysis: candidate, onApply });
    const view = render();
    expect(view.text()).toContain("Correction preview");
    expect(view.text().join(" ")).toContain("original analysis have not been changed");
    expect(view.text().join(" ")).toContain("automatically trusted");
    expect(view.labels).toContain("Apply correction");
    expect(view.labels).not.toContain("Train this OLL");
    expect(view.panel!.correctionPreview).toBe(true);
    expect(view.panel!.analysis).toBe(candidate);
    expect(view.panel!.solve.gripTrack).toBeUndefined();
    expect(selectedSolve.cfopAnalysisCorrection).toBeUndefined();
    view.button("Cancel").onClick();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });
  it("offers Apply only for a trusted candidate and closes only after successful acceptance", async () => {
    const candidate = fixture(undefined, true).selectedSolve.analysis!;
    const onApply = vi.fn().mockResolvedValue(false);
    const { render, onClose } = fixture(undefined, true, false, {}, { analysis: candidate, onApply });
    await render().button("Apply correction").onClick();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    expect(render().text().join(" ")).toContain("Nothing was applied");
    onApply.mockResolvedValue(true);
    await render().button("Apply correction").onClick();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("does not authorize a suspect preview for Apply, alternatives or Training", () => {
    const candidate = fixture(undefined, true, false).selectedSolve.analysis!;
    const onApply = vi.fn();
    const { render } = fixture(undefined, true, false, {}, { analysis: candidate, onApply });
    const view = render();
    expect(view.labels).not.toContain("Apply correction");
    expect(view.panel).toBeUndefined();
    expect(view.text().join(" ")).toContain("could not produce a reliable alternative");
    view.button("Cancel").onClick();
    expect(onApply).not.toHaveBeenCalled();
  });
});


it("keeps raw replay controls available but withholds Training for suspect analysis", () => {
  const { render } = fixture(undefined, true, false);
  const view = render();
  expect(view.labels.some(label => typeof label === "string" && label.startsWith("Train"))).toBe(false);
  expect(view.button("Play").disabled).not.toBe(true);
  expect(view.sequence.moves).toEqual(["R", "y", "F"]);
  expect(view.breakdown).toBeDefined();
});


it("uses the raw cube frame when suspect analysis has no grip track", () => {
  const { render } = fixture(undefined, true, false, { gripTrack: undefined });
  const view = render();
  expect(view.sequence.moves).toEqual(["R", "R"]);
  expect(view.button("Play").disabled).not.toBe(true);
  expect(view.labels.some(label => typeof label === "string" && label.startsWith("Train"))).toBe(false);
});
it("uses trusted Cross as a fallback only without a recorded grip track", () => {
  const analysed = { method: "CFOP", analysisVersion: ANALYSIS_VERSION, crossFace: "U", quality: { status: "trusted", issues: [] }, steps: [step("Cross", 0, 1), step("OLL", 1, 2)] } as unknown as Solve["analysis"];
  const view = fixture(undefined, true, true, { gripTrack: undefined, analysis: analysed }).render();
  expect(view.sequence.moves).not.toEqual(["R", "R"]);
});
it("keeps recorded grip authoritative even when the suspect Cross disagrees", () => {
  const analysed = { method: "CFOP", crossFace: "U", quality: { status: "suspect", issues: [] }, steps: [step("Cross", 0, 1), step("OLL", 1, 2)] } as unknown as Solve["analysis"];
  expect(fixture(undefined, true, false, { analysis: analysed }).render().sequence.moves).toEqual(["R", "y", "F"]);
});


it("manual veto uses raw replay without a track and withholds Training even for trusted analysis", () => {
  const view = fixture(undefined,true,true,{gripTrack:undefined,cfopAnalysisExcluded:true}).render();
  expect(view.sequence.moves).toEqual(["R","R"]);
  expect(view.panel).toBeUndefined();
  expect(view.labels.some(label=>typeof label === "string" && label.startsWith("Train"))).toBe(false);
  expect(view.button("Play").disabled).not.toBe(true);
});
it("manual veto preserves raw replay's recorded grip", () => {
  expect(fixture(undefined,true,true,{cfopAnalysisExcluded:true}).render().sequence.moves).toEqual(["R","y","F"]);
});
describe("Review previews", () => {
  it("only offers alternatives for a trusted analysis", () => {
    expect(fixture(undefined, true).render().panel).toBeDefined();
    expect(fixture(undefined, true, false).render().panel).toBeUndefined();
    expect(fixture(undefined, true, true, { cfopAnalysisExcluded: true }).render().panel).toBeUndefined();
    expect(fixture().render().panel).toBeUndefined();
  });

  it("plays an alternative from the moment it starts, then puts the replay back", () => {
    const { render } = fixture(undefined, true);
    let view = render();
    view.sequence.onSelect!(3); view = render();
    view.panel!.onPreview({ label: "Shorter", fromMove: 1, cubeMoves: ["U", "R'"] });
    view = render();
    // Rebuilt from the scramble and the first raw move, then the alternative itself.
    expect(hooks.player!.setup).toBe("F R R");
    expect(view.sequence.label).toBe("Alternative moves");
    expect(view.sequence.moves).toEqual(["U", "R'"]);
    expect(view.input("Move position").value).toBe(0);
    expect(view.text()).toContain("Back to your solve");
    view.button("Play").onClick(); view = render();
    expect(view.button("Pause")).toBeDefined();

    view.button("Back to your solve").onClick();
    view = render(); view = render();
    expect(view.sequence.label).toBe("Replay moves");
    expect(view.sequence.moves).toEqual(["R", "y", "F"]);
    expect(hooks.player!.setup).toBe("F R");
    expect(view.input("Move position").value).toBe(3);
  });

  it("writes the alternative in the grip the replay is in at that point", () => {
    const { render } = fixture(undefined, true);
    let view = render();
    // By the end the cube has been turned with a y: the cube's R is in front.
    view.panel!.onPreview({ label: "Pair", fromMove: 2, cubeMoves: ["R", "U"] });
    view = render();
    expect(hooks.player!.setup).toBe("F R R y F");
    expect(view.sequence.moves).toEqual(["F", "U"]);
  });

  it("plays the algorithm as written, after turning to the frame it is written in", () => {
    const { render } = fixture(undefined, true);
    let view = render();
    // Held with a y by then; the algorithm is written cross-down, as the cube was held at the start.
    view.panel!.onPreview({ label: "Pair", fromMove: 2, cubeMoves: ["L", "U"], alg: "r U" });
    view = render();
    expect(view.sequence.moves).toEqual(["y'", "r", "U"]);
    expect(view.sequence.tokenKind!(0)).toBe("rotation");
    expect(view.sequence.tokenKind!(1)).toBeUndefined();
  });

  it("leaves a preview with Escape before closing", () => {
    const { render, key, onClose } = fixture(undefined, true);
    const view = render();
    view.panel!.onPreview({ label: "Shorter", fromMove: 0, cubeMoves: ["R"] });
    render();
    key("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(render().sequence.label).toBe("Replay moves");
    key("Escape");
    expect(onClose).toHaveBeenCalled();
  });
});
