import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../../infrastructure/persistence/db";
import * as presets from "./trainingDrillPresets";

const config: presets.DrillPresetConfiguration = {
  activity: "drill", status: "configuring", context: { family: "f2l", library: "basic", position: "FR" },
  caseIds: ["F2L 4", "F2L 5"], task: "execution", strategy: "weighted",
};
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(100);
  vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000001");
});
afterEach(() => vi.restoreAllMocks());

describe("Saved Drill configuration workflow", () => {
  it("creates a UUID/timestamped trimmed snapshot containing configuration only", () => {
    const preset = presets.createTrainingDrillPreset("  New cases  ", { ...config, outcomes: [{ outcome: "skipped" }] } as never);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
    expect(preset).toEqual({ id: "00000000-0000-0000-0000-000000000001", name: "New cases",
      createdAt: 100, updatedAt: 100, context: config.context, caseIds: config.caseIds, task: "execution", strategy: "weighted" });
    expect(preset.caseIds).not.toBe(config.caseIds);
    expect(preset.context).not.toBe(config.context);
  });
  it.each([
    { activity: "single" }, { status: "running" }, { status: "summary" }, { caseIds: [] },
  ])("rejects unavailable configuration %j", change => {
    expect(() => presets.createTrainingDrillPreset("Cases", { ...config, ...change } as never)).toThrow();
  });
  it.each(["", "   ", "a".repeat(81)])("rejects invalid names", name => {
    expect(() => presets.createTrainingDrillPreset(name, config)).toThrow();
  });
  it("update replaces configuration only and rename changes only name and modification time", () => {
    const original = presets.createTrainingDrillPreset("Cases", config);
    vi.mocked(Date.now).mockReturnValue(200);
    const updated = presets.updateTrainingDrillPreset(original, { ...config,
      context: { family: "pll", trainingSet: "full" }, caseIds: ["T"], strategy: "sequence" });
    expect(updated).toEqual({ ...original, updatedAt: 200, context: { family: "pll", trainingSet: "full" }, caseIds: ["T"], strategy: "sequence" });
    expect(presets.renameTrainingDrillPreset(original, "  Renamed  ")).toEqual({ ...original, name: "Renamed", updatedAt: 200 });
    expect(original.updatedAt).toBe(100);
  });
  it("delegates loading, saving and deletion to the adapter", async () => {
    const preset = presets.createTrainingDrillPreset("Cases", config);
    vi.spyOn(db, "loadTrainingDrillPresets").mockResolvedValue([preset]);
    vi.spyOn(db, "saveTrainingDrillPreset").mockResolvedValue();
    vi.spyOn(db, "deleteTrainingDrillPreset").mockResolvedValue();
    expect(await presets.loadTrainingDrillPresets()).toEqual([preset]);
    await presets.saveTrainingDrillPreset(preset); await presets.deleteTrainingDrillPreset(preset.id);
    expect(db.saveTrainingDrillPreset).toHaveBeenCalledWith(preset);
    expect(db.deleteTrainingDrillPreset).toHaveBeenCalledWith(preset.id);
  });
});

it("captures Recognition task explicitly on creation/update and rejects a one-case recognition snapshot", () => {
  const saved = presets.createTrainingDrillPreset("Recognition", { ...config, task: "recognition" });
  expect(saved.task).toBe("recognition");
  expect(presets.updateTrainingDrillPreset(saved, { ...config, task: "execution" })).toMatchObject({ id: saved.id, task: "execution" });
  expect(() => presets.createTrainingDrillPreset("Too small", { ...config, task: "recognition", caseIds: ["F2L 4"] })).toThrow();
});
