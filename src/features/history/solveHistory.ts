import type { KPuzzle } from "cubing/kpuzzle";
import * as db from "../../infrastructure/persistence/db";
import { rebuildAnalysis } from "./repair";
import type { StatisticsSnapshot } from "../statistics/state/statistics";
import type { Solve } from "../../app/types";

/** Raw solve facts remain authoritative; persist each successful derived repair. */
async function repairLoadedSolves(kpuzzle: KPuzzle | undefined, solves: Solve[]): Promise<Solve[]> {
  if (!kpuzzle) return solves;
  const result: Solve[] = [];
  for (const solve of solves) {
    const rebuilt = rebuildAnalysis(kpuzzle, solve);
    if (rebuilt) await saveSolve(rebuilt);
    result.push(rebuilt ?? solve);
  }
  return result;
}

export async function loadSessionHistory(kpuzzle: KPuzzle | undefined, sessionId: string): Promise<Solve[]> {
  return repairLoadedSolves(kpuzzle, await db.loadSolves(sessionId));
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

export async function updateSolve(solve: Solve, changes: Partial<Solve>): Promise<Solve> {
  const updated = { ...solve, ...changes };
  await saveSolve(updated);
  return updated;
}

export async function deleteSolve(id: string): Promise<void> {
  await db.deleteSolve(id);
}
