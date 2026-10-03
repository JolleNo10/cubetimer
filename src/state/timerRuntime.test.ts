import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CubeModel } from "../cube/model";
import { get3x3x3 } from "../cube/puzzle";
import * as scramble from "../cube/scramble";
import * as recovery from "./recovery";
import { PhysicalCubeRuntime } from "./physicalCubeRuntime";
import { Store } from "./store";
import { TimerRuntime } from "./timerRuntime";
import { DEFAULT_SETTINGS, type Settings, type Solve } from "./types";

const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());
function fixture(changes: Partial<Settings> = {}) {
  let timer!: TimerRuntime;
  let active = true;
  let busy = false;
  const model = new CubeModel(kpuzzle);
  const physical = new PhysicalCubeRuntime({
    getTimerPhase: () => timer.state.get().phase, getTimerElapsed: now => timer.elapsedAt(now),
    canReplacePattern: () => timer.state.get().phase !== "solving", reportError: vi.fn(),
    onMove: (move, before) => timer.handleMove(move, before),
    onPatternChanged: () => timer.reconcilePhysicalState(),
  }, model);
  const elapsed = new Store(0), inspectionLeft = new Store<number | null>(null);
  const persistSolve = vi.fn<(solve: Solve) => Promise<void>>().mockResolvedValue();
  const startClock = vi.fn(), stopClock = vi.fn(), reportError = vi.fn(), onSolveRecorded = vi.fn();
  timer = new TimerRuntime({
    physical, getSettings: () => ({ ...DEFAULT_SETTINGS, sound: false, ...changes }),
    getEvent: () => "333", getSessionId: () => "session", isActive: () => active, contextBusy: () => busy,
    elapsed, inspectionLeft, persistSolve, startClock, stopClock, reportError, onSolveRecorded
  });
  vi.spyOn(scramble, "generateScramble").mockResolvedValue("R U");
  return {
    timer, physical, model, elapsed, inspectionLeft, persistSolve, startClock, stopClock, reportError, onSolveRecorded,
    setActive: (value: boolean) => { active = value; }, setBusy: (value: boolean) => { busy = value; }
  };
}

describe("TimerRuntime", () => {
  it("tracks physical scramble progress and starts on the first solve turn", () => {
    const f = fixture(); f.physical.setVirtualCube(true); f.timer.setScramble("R U");
    f.physical.injectMove("R"); expect(f.timer.state.get().scrambleProgress?.index).toBe(1);
    f.physical.injectMove("U"); expect(f.timer.state.get().phase).toBe("ready");
    f.physical.injectMove("U'");
    expect(f.timer.state.get()).toMatchObject({ phase: "solving", liveMoves: ["U'"], solveSource: "smartcube" });
    expect(f.startClock).toHaveBeenCalledOnce();
  });
  it.each([[15_000, "none"], [15_001, "+2"], [17_001, "DNF"]] as const)("publishes inspection penalty at %sms", (spent, penalty) => {
    const f = fixture({ inspection: true, requireScramble: false });
    vi.spyOn(performance, "now").mockReturnValue(100);
    f.timer.startFromKeyboard(); expect(f.timer.state.get().phase).toBe("inspection");
    expect(f.timer.tick(100 + spent)).toBe(true);
    expect(f.inspectionLeft.get()).toBe(15_000 - spent);
    expect(f.timer.state.get().inspectionPenalty).toBe(penalty);
    f.timer.startFromKeyboard(); expect(f.timer.state.get().phase).toBe("solving");
  });
  it("keeps keyboard timing and solve persistence outside device ownership", async () => {
    const f = fixture({ requireScramble: false }); f.timer.setScramble("R U");
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    f.timer.startFromKeyboard(); f.timer.tick(800); expect(f.elapsed.get()).toBe(700);
    now.mockReturnValue(1100); f.timer.startFromKeyboard();
    await vi.waitFor(() => expect(f.onSolveRecorded).toHaveBeenCalledOnce());
    expect(f.persistSolve).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session", rawMs: 1000, source: "keyboard", moves: [], scramble: "R U" }));
    expect(f.stopClock).toHaveBeenCalledOnce();
  });
  it("records SmartCube raw moves, starting pattern and fitted timestamps", async () => {
    const f = fixture(); f.physical.setVirtualCube(true); f.timer.setScramble("R U");
    f.physical.injectMove("R"); f.physical.injectMove("U"); const starting = f.model.facelets;
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    f.physical.injectMove("U'"); now.mockReturnValue(200); f.physical.injectMove("R'");
    await vi.waitFor(() => expect(f.onSolveRecorded).toHaveBeenCalledOnce());
    expect(f.persistSolve).toHaveBeenCalledWith(expect.objectContaining({
      rawMs: 100, source: "smartcube", scrambledFacelets: starting,
      moves: [{ move: "U'", t: 0 }, { move: "R'", t: 100 }], analysis: expect.any(Object)
    }));
  });
  it("preserves replay/practice facts", async () => {
    const f = fixture({ requireScramble: false }); f.timer.replayScramble("R");
    f.timer.startFromKeyboard(); f.timer.startFromKeyboard();
    await vi.waitFor(() => expect(f.persistSolve).toHaveBeenCalledOnce());
    expect(f.persistSolve.mock.calls[0][0]).toMatchObject({ replay: true, practice: true, scramble: "R" });
  });
  it("cancels without recording or changing the physical model", () => {
    const f = fixture({ requireScramble: false }); f.model.applyMove("R"); const pattern = f.model.pattern;
    f.timer.startFromKeyboard(); f.timer.cancelForArea();
    expect(f.model.pattern).toBe(pattern); expect(f.persistSolve).not.toHaveBeenCalled();
    expect(f.timer.state.get()).toMatchObject({ phase: "scrambling", solveSource: null, liveMoves: [], recoveryPending: false });
    expect(f.timer.tick(100)).toBe(false);
  });
  it("respects area and pending Session context on keyboard and physical start", () => {
    const f = fixture({ requireScramble: false }); f.timer.setScramble("R"); f.setBusy(true);
    f.timer.startFromKeyboard(); f.physical.injectMove("U"); expect(f.timer.state.get().phase).toBe("ready");
    f.setBusy(false); f.setActive(false); f.timer.startFromKeyboard(); f.physical.injectMove("R");
    expect(f.timer.state.get().phase).toBe("ready"); expect(f.persistSolve).not.toHaveBeenCalled();
  });
  it("does not let stale scramble generation replace a later request", async () => {
    const f = fixture(); let resolve!: (alg: string) => void;
    vi.mocked(scramble.generateScramble).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const pending = f.timer.newScramble(); f.timer.setScramble("F"); resolve("R U"); await pending;
    expect(f.timer.state.get().scramble).toBe("F");
  });
  it("reports generation failure through the application error seam", async () => {
    const f = fixture(); vi.mocked(scramble.generateScramble).mockRejectedValueOnce(new Error("failed"));
    await f.timer.newScramble(); expect(f.reportError).toHaveBeenCalledWith(expect.stringContaining("failed"));
    expect(f.timer.state.get()).not.toHaveProperty("error");
  });
  it("cancels recovery when a new scramble owns the tracker", async () => {
    const f = fixture(); let resolve!: (value: recovery.Recovery) => void;
    vi.spyOn(recovery, "calculateRecovery").mockReturnValueOnce(new Promise(r => { resolve = r; }));
    f.physical.setVirtualCube(true); f.timer.setScramble("R U"); f.physical.injectMove("F");
    expect(f.timer.state.get().recoveryPending).toBe(true);
    f.timer.setScramble("F"); resolve({ alg: "F'", resumeAt: 0 }); await Promise.resolve();
    expect(f.timer.state.get()).toMatchObject({ scramble: "F", recovery: null, recoveryPending: false });
  });
  it("adopts the physical pattern through the solver without replacing the model", async () => {
    const f = fixture(); f.model.applyAlg(new Alg("R U")); const pattern = f.model.pattern;
    await f.timer.useCubeStateAsScramble();
    expect(kpuzzle.defaultPattern().applyAlg(f.timer.state.get().scramble).isIdentical(pattern)).toBe(true);
    expect(f.model.pattern).toBe(pattern); expect(f.timer.state.get().recoveryPending).toBe(false);
  });
});
