import type { KPuzzle } from "cubing/kpuzzle";
import * as db from "../../infrastructure/persistence/db";
import { buildStateOnlyCfopAnalysis, rebuildAnalysis } from "./repair";
import { isTrustedCfopAnalysis, type SolveAnalysis } from "../../cube/analysis";
import type { StatisticsSnapshot } from "../statistics/state/statistics";
import type { Solve } from "../../app/types";

/** Raw solve facts remain authoritative; persist each successful derived repair. */
async function repairLoadedSolves(kpuzzle: KPuzzle | undefined, solves: Solve[]): Promise<Solve[]> {
  if (!kpuzzle) return solves;
  const result: Solve[] = [];
  let repairs: Solve[] = [];
  for (const solve of solves) {
    const rebuilt = rebuildAnalysis(kpuzzle, solve);
    if (rebuilt) {
      repairs.push(rebuilt);
      if (repairs.length === 200) {
        await saveSolves(repairs);
        repairs = [];
      }
    }
    result.push(rebuilt ?? solve);
  }
  if (repairs.length > 0) await saveSolves(repairs);
  return result;
}

export async function loadSessionHistory(kpuzzle: KPuzzle | undefined, sessionId: string): Promise<Solve[]> {
  return repairLoadedSolves(kpuzzle, await db.loadSolves(sessionId));
}

/** Read a record outside the active Session without derived repair or writes. */
export async function findSolve(id: string): Promise<Solve | undefined> {
  return db.loadSolve(id);
}

/** All-history loading has no dependency on the active runtime context. */
export async function loadStatisticsSnapshot(kpuzzle: KPuzzle | undefined): Promise<StatisticsSnapshot> {
  const [sessions, solves] = await Promise.all([db.loadSessions(), db.loadAllSolves()]);
  const repaired = await repairLoadedSolves(kpuzzle, solves);
  repaired.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { sessions, solves: repaired };
}

export async function saveSolve(solve: Solve): Promise<void> {
  await db.saveSolve(solve);
}

export async function saveSolves(solves: readonly Solve[]): Promise<void> {
  await db.saveSolves(solves);
}

export async function updateSolve(solve: Solve, changes: Partial<Solve>): Promise<Solve> {
  const updated = { ...solve, ...changes };
  await saveSolve(updated);
  return updated;
}

export function previewCfopCorrection(kpuzzle: KPuzzle | undefined, solve: Solve): { mode: "state-only"; analysis: SolveAnalysis } | null {
  const analysis = kpuzzle ? buildStateOnlyCfopAnalysis(kpuzzle, solve) : null;
  return analysis ? { mode: "state-only", analysis } : null;
}

/** Recompute from raw facts at acceptance; a UI preview is never authoritative. */
export async function applyCfopCorrection(kpuzzle: KPuzzle | undefined, solve: Solve): Promise<Solve | null> {
  const candidate = previewCfopCorrection(kpuzzle, solve);
  if (!candidate || !isTrustedCfopAnalysis(candidate.analysis)) return null;
  return updateSolve(solve, { cfopAnalysisCorrection: { ...candidate, acceptedAt: Date.now() } });
}

export async function clearCfopCorrection(solve: Solve): Promise<Solve> {
  const { cfopAnalysisCorrection: _correction, ...original } = solve;
  await saveSolve(original);
  return original;
}

export async function deleteSolve(id: string): Promise<void> {
  await db.deleteSolve(id);
}
