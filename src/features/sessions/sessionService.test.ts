import { afterEach, describe, expect, it, vi } from "vitest";
import { get3x3x3 } from "../../cube/puzzle";
import { DEFAULT_EVENT_ID } from "../../cube/scramble";
import * as db from "../../infrastructure/persistence/db";
import * as service from "./sessionService";
import type { Session, Solve } from "../../app/types";

const kpuzzle = await get3x3x3();
const session = (id: string, event: Session["event"] = DEFAULT_EVENT_ID): Session =>
  ({ id, name: `Session ${id}`, event, createdAt: Number(id) || 0 });
const solve: Solve = {
  id: "solve-1", sessionId: "1", createdAt: 0, rawMs: 1000,
  penalty: "none", scramble: "R U", source: "keyboard", moves: [],
};
const context = (sessions = [session("1")], solves: Solve[] = []): service.SessionContext =>
  ({ sessions, sessionId: sessions[0].id, solves });

afterEach(() => vi.restoreAllMocks());

describe("Session persisted transitions", () => {
  it("does not create an initial Session when startup history loading fails", async () => {
    vi.spyOn(db, "loadSessions").mockResolvedValue([]);
    vi.spyOn(db, "loadSolves").mockRejectedValue(new Error("History storage failed"));
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    await expect(service.loadInitialContext(kpuzzle)).rejects.toThrow("History storage failed");
    expect(save).not.toHaveBeenCalled();
  });
  it("creates Session 1 with the default event when no Sessions exist", async () => {
    vi.spyOn(db, "loadSessions").mockResolvedValue([]);
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const result = await service.loadInitialContext(kpuzzle);
    expect(result.sessions).toEqual([{
      id: expect.any(String), name: "Session 1", event: DEFAULT_EVENT_ID,
      createdAt: expect.any(Number),
    }]);
    expect(save).toHaveBeenCalledWith(result.sessions[0]);
    expect(result.sessionId).toBe(result.sessions[0].id);
    expect(result.solves).toEqual([]);
  });

  it("initially selects the newest Session and loads its history", async () => {
    const sessions = [session("1"), session("2", "222")];
    const historical = { ...solve, sessionId: "2" };
    vi.spyOn(db, "loadSessions").mockResolvedValue(sessions);
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([historical]);
    expect(await service.loadInitialContext(kpuzzle)).toEqual({
      sessions, sessionId: "2", solves: [historical],
    });
    expect(load).toHaveBeenCalledWith("2");
  });

  it.each(["333", "222"] as const)("selects history and reports an event transition to %s", async (event) => {
    const previous = context([session("1"), session("2", event)], [solve]);
    const historical = { ...solve, sessionId: "2" };
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([historical]);
    expect(await service.selectSession(kpuzzle, previous, "2")).toEqual({
      sessions: previous.sessions, sessionId: "2", solves: [historical], eventChanged: event !== "333",
    });
    expect(load).toHaveBeenCalledWith("2");
    expect(previous.sessionId).toBe("1");
    expect(previous.solves).toEqual([solve]);
  });

  it("ignores an unknown Session and an unchanged event", async () => {
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    expect(await service.selectSession(kpuzzle, context(), "missing")).toBeUndefined();
    expect(await service.changeEvent(kpuzzle, context(), DEFAULT_EVENT_ID)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("changes an empty Session event in place", async () => {
    const previous = context();
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    const result = await service.changeEvent(kpuzzle, previous, "222");
    expect(result).toEqual({ ...previous, sessions: [{ ...previous.sessions[0], event: "222" }], eventChanged: true });
    expect(save).toHaveBeenCalledExactlyOnceWith(result!.sessions[0]);
    expect(previous.sessions[0].event).toBe(DEFAULT_EVENT_ID);
  });

  it("preserves a historical Session and creates/selects Session 2 for a new event", async () => {
    const previous = context(undefined, [solve]);
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const result = (await service.changeEvent(kpuzzle, previous, "222"))!;
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0]).toEqual(previous.sessions[0]);
    expect(result.sessions[1]).toMatchObject({ name: "Session 2", event: "222" });
    expect(result.sessions[1].id).not.toBe("1");
    expect(result.sessionId).toBe(result.sessions[1].id);
    expect(result.solves).toEqual([]);
    expect(result.eventChanged).toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(result.sessions[1]);
    expect(solve.sessionId).toBe("1");
  });

  it("inherits the selected event for a manually created Session, unless explicitly supplied", async () => {
    vi.spyOn(db, "saveSession").mockResolvedValue();
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    const previous = context([session("1", "222")]);
    const inherited = await service.createSession(kpuzzle, previous, "Named");
    expect(inherited.sessions.at(-1)).toMatchObject({ name: "Named", event: "222" });
    expect(inherited.eventChanged).toBe(false);
    const explicit = await service.createSession(kpuzzle, previous, "Explicit", "333");
    expect(explicit.sessions.at(-1)?.event).toBe("333");
    expect(explicit.eventChanged).toBe(true);
  });

  it("persists rename while preserving event identity", async () => {
    const original = session("1", "222");
    const save = vi.spyOn(db, "saveSession").mockResolvedValue();
    const updated = await service.renameSession([original], "1", "Renamed");
    expect(updated).toEqual({ ...original, name: "Renamed" });
    expect(save).toHaveBeenCalledExactlyOnceWith(updated);
    expect(await service.renameSession([original], "missing", "Ignored")).toBeUndefined();
    expect(original.name).toBe("Session 1");
  });

  it("cannot delete the last Session", async () => {
    const remove = vi.spyOn(db, "deleteSession").mockResolvedValue();
    expect(await service.deleteSession(kpuzzle, context(), "1")).toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes a non-active Session without reloading or replacing active history", async () => {
    const previous = context([session("1"), session("2", "222")], [solve]);
    const remove = vi.spyOn(db, "deleteSession").mockResolvedValue();
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    expect(await service.deleteSession(kpuzzle, previous, "2")).toEqual({
      ...previous, sessions: [previous.sessions[0]], eventChanged: false,
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith("2");
    expect(load).not.toHaveBeenCalled();
  });

  it.each(["333", "222"] as const)("deleting the active Session selects newest fallback with event %s", async (event) => {
    const previous = context([session("1"), session("2"), session("3", event)], [solve]);
    const replacement = { ...solve, sessionId: "3" };
    vi.spyOn(db, "deleteSession").mockResolvedValue();
    const load = vi.spyOn(db, "loadSolves").mockResolvedValue([replacement]);
    expect(await service.deleteSession(kpuzzle, previous, "1")).toEqual({
      sessions: previous.sessions.slice(1), sessionId: "3", solves: [replacement], eventChanged: event !== "333",
    });
    expect(load).toHaveBeenCalledExactlyOnceWith("3");
  });

  it.each([true, false])("reload retains the selected Session when present: %s", async (retained) => {
    const previous = context([session("1")]);
    const sessions = retained ? [session("1"), session("2", "222")] : [session("2", "222")];
    vi.spyOn(db, "loadSessions").mockResolvedValue(sessions);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    expect(await service.reloadContext(kpuzzle, previous)).toEqual({
      sessions, sessionId: retained ? "1" : "2", solves: [], eventChanged: !retained,
    });
  });

  it("reload reports an imported event change and supports an empty database", async () => {
    vi.spyOn(db, "loadSessions").mockResolvedValueOnce([session("1", "222")]).mockResolvedValueOnce([]);
    vi.spyOn(db, "loadSolves").mockResolvedValue([]);
    expect((await service.reloadContext(kpuzzle, context())).eventChanged).toBe(true);
    expect(await service.reloadContext(kpuzzle, context())).toEqual({ sessions: [], sessionId: "", solves: [], eventChanged: false });
  });
});

describe("Session import compatibility", () => {
  it.each([
    ["333", true, true, false],
    ["222", false, false, false],
    ["222", true, false, true],
    ["222", false, true, true],
  ] as const)("merges event %s with existing history %s and incoming history %s", async (event, existingHistory, incomingHistory, rejected) => {
    vi.spyOn(db, "loadSessions").mockResolvedValue([session("1")]);
    const indexed = vi.spyOn(db, "loadSessionIdsWithSolves").mockResolvedValue(new Set(existingHistory ? ["1"] : []));
    const fullHistory = vi.spyOn(db, "loadAllSolves").mockRejectedValue(new Error("Full history must not be loaded"));
    const operation = service.assertImportSessionCompatibility([session("1", event)], new Set(incomingHistory ? ["1"] : []));
    if (rejected) await expect(operation).rejects.toThrow(/different events while solve history exists/);
    else await expect(operation).resolves.toEqual([session("1")]);
    expect(indexed).toHaveBeenCalledOnce();
    expect(fullHistory).not.toHaveBeenCalled();
  });

  it("rejects conflicting definitions within one incoming import even without history", async () => {
    vi.spyOn(db, "loadSessions").mockResolvedValue([]);
    vi.spyOn(db, "loadSessionIdsWithSolves").mockResolvedValue(new Set());
    await expect(service.assertImportSessionCompatibility([session("1"), session("1", "222")], new Set())).rejects.toThrow(/conflicting events/);
  });
});
