import { Alg } from "cubing/alg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CubeModel } from "../../cube/model";
import { get3x3x3 } from "../../cube/puzzle";
import * as analysis from "../../cube/analysis";
import * as gripTrack from "../../cube/gripTrack";
import * as scramble from "../../cube/scramble";
import * as solver from "../../cube/solver";
import * as recovery from "../../shared/recovery";
import { PhysicalCubeRuntime } from "../../app/PhysicalCubeRuntime";
import { Store } from "../../shared/store";
import { TimerRuntime } from "./TimerRuntime";
import { DEFAULT_SETTINGS, type Settings, type Solve } from "../../app/types";

const kpuzzle = await get3x3x3();
afterEach(() => vi.restoreAllMocks());
function fixture(changes: Partial<Settings> = {}, modelAvailable = true) {
  let timer!: TimerRuntime;
  let active = true;
  let busy = false;
  const model = new CubeModel(kpuzzle);
  const physical = new PhysicalCubeRuntime({
    getTimerPhase: () => timer.state.get().phase, getTimerElapsed: now => timer.elapsedAt(now),
    canReplacePattern: () => timer.state.get().phase !== "solving", reportError: vi.fn(),
    onMove: (move, before) => timer.handleMove(move, before),
    onPatternChanged: () => timer.reconcilePhysicalState(),
  }, modelAvailable ? model : null);
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
  it("coalesces moves during recovery and publishes only the latest physical position", async () => {
    const f = fixture();
    let resolveA!: (value: recovery.Recovery) => void;
    let resolveB!: (value: recovery.Recovery) => void;
    const calculate = vi.spyOn(recovery, "calculateRecovery")
      .mockReturnValueOnce(new Promise(fulfil => { resolveA = fulfil; }))
      .mockReturnValueOnce(new Promise(fulfil => { resolveB = fulfil; }));
    f.physical.setVirtualCube(true); f.timer.setScramble("R U");
    const published: (recovery.Recovery | null)[] = [];
    f.timer.state.subscribe(() => published.push(f.timer.state.get().recovery));
    f.physical.injectMove("F");
    f.physical.injectMove("B"); f.physical.injectMove("L");
    const latest = f.model.pattern;
    expect(calculate).toHaveBeenCalledOnce();
    resolveA({ alg: "old", resumeAt: 0 });
    await vi.waitFor(() => expect(calculate).toHaveBeenCalledTimes(2));
    expect(published).not.toContainEqual({ alg: "old", resumeAt: 0 });
    expect(calculate.mock.calls[1][0]).toBe(latest);
    expect(f.timer.state.get().recoveryPending).toBe(true);
    resolveB({ alg: "latest", resumeAt: 0 });
    await vi.waitFor(() => expect(f.timer.state.get()).toMatchObject({ recovery: { alg: "latest", resumeAt: 0 }, recoveryPending: false }));
  });
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
  it("does not restore stale recovery after returning on-track", async () => {
    const f = fixture(); let resolve!: (value: recovery.Recovery) => void;
    const calculate = vi.spyOn(recovery, "calculateRecovery").mockReturnValueOnce(new Promise(r => { resolve = r; }));
    f.physical.setVirtualCube(true); f.timer.setScramble("R U");
    f.physical.injectMove("F"); f.physical.injectMove("F'");
    expect(f.timer.state.get()).toMatchObject({ recovery: null, recoveryPending: false });
    resolve({ alg: "old", resumeAt: 0 }); await Promise.resolve();
    expect(f.timer.state.get()).toMatchObject({ recovery: null, recoveryPending: false });
    expect(calculate).toHaveBeenCalledOnce();
  });
  it("keeps replacement tracker recovery pending while the old calculation exits", async () => {
    const f = fixture(); let resolveA!: (value: recovery.Recovery) => void, resolveB!: (value: recovery.Recovery) => void;
    const calculate = vi.spyOn(recovery, "calculateRecovery")
      .mockReturnValueOnce(new Promise(r => { resolveA = r; }))
      .mockReturnValueOnce(new Promise(r => { resolveB = r; }));
    f.physical.setVirtualCube(true); f.timer.setScramble("R U"); f.physical.injectMove("F");
    f.timer.setScramble("B");
    resolveA({ alg: "old", resumeAt: 0 });
    await vi.waitFor(() => expect(calculate).toHaveBeenCalledTimes(2));
    expect(f.timer.state.get()).toMatchObject({ scramble: "B", recovery: null, recoveryPending: true });
    resolveB({ alg: "current", resumeAt: 1 });
    await vi.waitFor(() => expect(f.timer.state.get()).toMatchObject({ recovery: { alg: "current", resumeAt: 1 }, recoveryPending: false }));
  });
  it("does not let physical-state adoption overwrite a newer explicit scramble", async () => {
    const f = fixture(); let resolve!: (alg: Alg) => void;
    vi.spyOn(solver, "solveAlg").mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const pending = f.timer.useCubeStateAsScramble(); f.timer.setScramble("F");
    resolve(new Alg("R'")); expect(await pending).toBe("superseded");
    expect(f.timer.state.get()).toMatchObject({ scramble: "F", recoveryPending: false });
  });
  it("adopts the physical pattern through the solver without replacing the model", async () => {
    const f = fixture(); f.model.applyAlg(new Alg("R U")); const pattern = f.model.pattern;
    expect(await f.timer.useCubeStateAsScramble()).toBe("applied");
    expect(kpuzzle.defaultPattern().applyAlg(f.timer.state.get().scramble).isIdentical(pattern)).toBe(true);
    expect(f.model.pattern).toBe(pattern); expect(f.timer.state.get().recoveryPending).toBe(false);
  });
  it("lets a newer generation keep ownership after physical-state adoption resolves", async () => {
    const f = fixture(); let resolveAdoption!: (alg: Alg) => void, resolveGeneration!: (alg: string) => void;
    vi.spyOn(solver, "solveAlg").mockReturnValueOnce(new Promise(r => { resolveAdoption = r; }));
    vi.mocked(scramble.generateScramble).mockReturnValueOnce(new Promise(r => { resolveGeneration = r; }));
    const adoption = f.timer.useCubeStateAsScramble();
    const generation = f.timer.newScramble();
    resolveAdoption(new Alg("R'")); expect(await adoption).toBe("superseded");
    expect(f.timer.state.get().scramble).toBe("");
    resolveGeneration("F"); await generation;
    expect(f.timer.state.get().scramble).toBe("F");
  });
  it.each([false, true])("does not clear newer adoption pending state when an old operation fails: %s", async fails => {
    const f = fixture(); let resolveA!: (alg: Alg) => void, rejectA!: (error: Error) => void, resolveB!: (alg: Alg) => void;
    vi.spyOn(solver, "solveAlg")
      .mockReturnValueOnce(new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveB = resolve; }));
    const a = f.timer.useCubeStateAsScramble(), b = f.timer.useCubeStateAsScramble();
    if (fails) rejectA(new Error("stale failure")); else resolveA(new Alg("R'"));
    expect(await a).toBe("superseded");
    expect(f.timer.state.get().recoveryPending).toBe(true);
    expect(f.reportError).not.toHaveBeenCalled();
    resolveB(new Alg("F'")); expect(await b).toBe("applied");
    expect(f.timer.state.get()).toMatchObject({ scramble: "F", recoveryPending: false });
  });
  it("reports current adoption failure without rejecting the UI action", async () => {
    const f = fixture();
    vi.spyOn(solver, "solveAlg").mockRejectedValueOnce(new Error("adoption failed"));
    expect(await f.timer.useCubeStateAsScramble()).toBe("failed");
    expect(f.reportError).toHaveBeenCalledWith("Error: adoption failed");
    expect(f.timer.state.get().recoveryPending).toBe(false);
  });
  it("distinguishes an unavailable physical pattern from successful adoption", async () => {
    const f = fixture({}, false);
    const solve = vi.spyOn(solver, "solveAlg");
    expect(await f.timer.useCubeStateAsScramble()).toBe("unavailable");
    expect(solve).not.toHaveBeenCalled();
  });
  it.each(["prepareForPhysicalScrambleAdoption", "parkForReview", "invalidateScrambleContext"] as const)("%s clears stale recovery through the Timer owner", async operation => {
    const f = fixture(); let resolve!: (value: recovery.Recovery) => void;
    vi.spyOn(recovery, "calculateRecovery").mockReturnValueOnce(new Promise(fulfil => { resolve = fulfil; }));
    f.physical.setVirtualCube(true); f.timer.setScramble("R U"); f.physical.injectMove("F");
    const pattern = f.model.pattern;
    f.timer.state.update(state => ({ ...state, scrambleGeneration: { kind: "cross" }, liveMoves: ["R"] }));
    f.timer[operation]();
    expect(f.timer.state.get()).toMatchObject({
      recovery: null, recoveryPending: false, scrambleProgress: null,
      scramble: operation === "invalidateScrambleContext" ? "R U" : "",
      phase: operation === "parkForReview" ? "finished" : "scrambling",
    });
    if (operation === "prepareForPhysicalScrambleAdoption") {
      expect(f.timer.state.get().scrambleGeneration).toEqual({ kind: "cross" });
    } else expect(f.timer.state.get().scrambleGeneration).toBeNull();
    if (operation !== "invalidateScrambleContext") expect(f.timer.state.get().liveMoves).toEqual([]);
    resolve({ alg: "old", resumeAt: 0 }); await Promise.resolve();
    expect(f.timer.state.get()).toMatchObject({ recovery: null, recoveryPending: false });
    expect(f.model.pattern).toBe(pattern);
    expect(scramble.generateScramble).not.toHaveBeenCalled();
    expect(f.persistSolve).not.toHaveBeenCalled();
  });
});


describe("independent solve-start evidence", () => {
  it.each(["D", "U", null] as const)("captures %s without feeding inferred Cross back into grip tracking", async bottom => {
    const f = fixture();
    const solution = new Alg("R U R' U R U2 R'");
    f.physical.setVirtualCube(true);
    f.timer.setScramble(solution.invert().toString());
    for (const node of solution.invert().childAlgNodes()) f.physical.injectMove(node.toString());
    expect(f.timer.state.get().phase).toBe("ready");
    const observed = vi.spyOn(f.physical, "grip", "get").mockReturnValue(bottom ? { bottom, front: "F" } : null);
    vi.spyOn(f.physical, "gripLocked", "get").mockReturnValue(true);
    vi.spyOn(f.physical, "gripReference", "get").mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
    vi.spyOn(f.physical, "pose", "get").mockReturnValue({ x: 0, y: 0, z: 0, w: 1 });
    const hold = vi.spyOn(f.physical, "holdBottom").mockImplementation(() => observed.mockReturnValue({ bottom: "L", front: "F" }));
    const track = vi.spyOn(gripTrack, "trackGrip");
    const analyse = vi.spyOn(analysis, "analyseSolve");
    let time = 100;
    vi.spyOn(performance, "now").mockImplementation(() => time += 200);
    for (const node of solution.childAlgNodes()) f.physical.injectMove(node.toString());
    await vi.waitFor(() => expect(f.persistSolve).toHaveBeenCalledOnce());
    expect(hold).toHaveBeenCalledWith(bottom);
    const saved = f.persistSolve.mock.calls[0][0];
    expect(saved.solveStartBottomFace).toBe(bottom ?? undefined);
    expect(track).toHaveBeenCalledOnce();
    expect(track.mock.calls[0][0].crossFace).toBe(bottom ?? undefined);
    expect(analyse.mock.calls.every(call => call[3] === (bottom ?? undefined))).toBe(true);
    expect(track.mock.calls[0][0].boundaries === undefined).toBe(bottom !== "D");
    if (bottom === null) expect(track.mock.calls[0][0]).not.toHaveProperty("crossFace");
  });
  it("clears captured evidence when an attempt is cancelled", async () => {
    const f = fixture(); f.physical.setVirtualCube(true); f.timer.setScramble("R U");
    f.physical.injectMove("R"); f.physical.injectMove("U");
    const grip = vi.spyOn(f.physical, "grip", "get").mockReturnValue({ bottom: "D", front: "F" });
    f.physical.injectMove("U'"); f.timer.cancel();
    f.model.applyMove("R'"); f.timer.setScramble("R U");
    f.physical.injectMove("R"); f.physical.injectMove("U");
    grip.mockReturnValue(null);
    f.physical.injectMove("U'"); f.physical.injectMove("R'");
    await vi.waitFor(() => expect(f.persistSolve).toHaveBeenCalledOnce());
    expect(f.persistSolve.mock.calls[0][0].solveStartBottomFace).toBeUndefined();
  });
});
