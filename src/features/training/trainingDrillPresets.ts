import type { TrainingDrillPreset, TrainingDrillPresetContext, TrainingDrillStrategy } from "../../app/types";
import * as db from "../../infrastructure/persistence/db";

export type DrillPresetConfiguration = {
  activity: "single" | "drill";
  status: "configuring" | "running" | "summary";
  context: TrainingDrillPresetContext;
  caseIds: readonly string[];
  strategy: TrainingDrillStrategy;
};

function presetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error("Use a saved Drill name between 1 and 80 characters.");
  return trimmed;
}

function snapshotDrillConfiguration(config: DrillPresetConfiguration) {
  if (config.activity !== "drill" || config.status !== "configuring" || !config.caseIds.length)
    throw new Error("Configure a Drill with at least one selected case first.");
  return { context: { ...config.context }, caseIds: [...config.caseIds], strategy: config.strategy };
}

function normalizePresetOrThrow(preset: TrainingDrillPreset): TrainingDrillPreset {
  const normalized = db.normalizeTrainingDrillPreset(preset);
  if (!normalized) throw new Error("Invalid saved Drill configuration.");
  return normalized;
}

export function createTrainingDrillPreset(name: string, config: DrillPresetConfiguration): TrainingDrillPreset {
  const normalizedName = presetName(name);
  const snapshot = snapshotDrillConfiguration(config);
  const now = Date.now();
  return normalizePresetOrThrow({ id: crypto.randomUUID(), name: normalizedName, createdAt: now, updatedAt: now, ...snapshot });
}

export function updateTrainingDrillPreset(preset: TrainingDrillPreset, config: DrillPresetConfiguration): TrainingDrillPreset {
  return normalizePresetOrThrow({ ...preset, ...snapshotDrillConfiguration(config), updatedAt: Date.now() });
}

export function renameTrainingDrillPreset(preset: TrainingDrillPreset, name: string): TrainingDrillPreset {
  return normalizePresetOrThrow({ ...preset, name: presetName(name), updatedAt: Date.now() });
}

export function loadTrainingDrillPresets() { return db.loadTrainingDrillPresets(); }
export function saveTrainingDrillPreset(preset: TrainingDrillPreset) { return db.saveTrainingDrillPreset(preset); }
export function deleteTrainingDrillPreset(id: string) { return db.deleteTrainingDrillPreset(id); }
