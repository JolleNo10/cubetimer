import { applySolveThreshold } from "../../../statistics/state/solveThreshold";
import { useEffect, useMemo, useState } from "react";
import { useController, useSessionState, useSettings } from "../../../../app/useController";
import type { CompareScope, Session, Solve } from "../../../../app/types";
import { caseSpread, compareSolveToHistory } from "../../../statistics/state/stats";

/**
 * The earlier solves a result is compared with, following its Session's choice.
 *
 * The session's own solves are already at hand. Comparing with the whole event needs
 * every Session's history, which is loaded through the Controller once per result.
 */
export function useResultHistory(solve: Solve, solves: readonly Solve[]) {
  const controller = useController();
  const { slowSolveThreshold, slowSolveHandling } = useSettings();
  const { sessions } = useSessionState();
  const scope: CompareScope = sessions.find((session) => session.id === solve.sessionId)?.compareScope ?? "session";
  const [history, setHistory] = useState<{ solveId: string; solves: Solve[]; sessions: Session[] } | null>(null);

  useEffect(() => {
    if (scope !== "event") return;
    let current = true;
    void controller.loadStatisticsSnapshot().then((snapshot) => {
      if (current) setHistory({ solveId: solve.id, ...snapshot });
    });
    return () => { current = false; };
  }, [controller, scope, solve.id]);

  const wide = scope === "event" && history?.solveId === solve.id ? history : null;
  const loading = scope === "event" && wide === null;
  return useMemo(() => {
    // Until the wider history arrives, the session's own solves stand in for it.
    const source = applySolveThreshold(wide?.solves ?? solves, { slowSolveThreshold, slowSolveHandling });
    const options = wide ? { scope, sessions: wide.sessions } : { scope: "session" as const, sessions };
    return {
      scope,
      loading,
      comparison: compareSolveToHistory(solve, source, options),
      spread: loading ? null : caseSpread(solve, source, options),
      setScope: (next: CompareScope) => void controller.setSessionCompareScope(solve.sessionId, next),
    };
  }, [controller, loading, scope, sessions, solve, solves, wide, slowSolveThreshold, slowSolveHandling]);
}
