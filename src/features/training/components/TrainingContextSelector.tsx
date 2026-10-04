import type { TrainingDrillPresetContext } from "../../../app/types";
import { F2L_POSITIONS, f2lPositionLabel } from "../../../cube/f2lCases";

/** Local browse controls only: no Controller actions or Settings subscription. */
export function TrainingContextSelector({ context, onChange, all = false }: {
  context: TrainingDrillPresetContext | null; onChange: (context: TrainingDrillPresetContext | null) => void; all?: boolean;
}) {
  return <div className="row wrap" role="group" aria-label="Browse Training context">
    <label>Family <select aria-label="Browse family" value={context?.family ?? "all"} onChange={event => {
      const family = event.target.value;
      onChange(family === "all" ? null : family === "f2l" ? { family, library: "basic", position: "FR" } :
        { family: family as "oll" | "pll", trainingSet: "full" });
    }}>{all ? <option value="all">All</option> : null}<option value="f2l">F2L</option><option value="oll">OLL</option><option value="pll">PLL</option></select></label>
    {context?.family === "f2l" ? <>
      <label>Library <select aria-label="Browse F2L library" value={context.library} onChange={event => onChange({ ...context, library: event.target.value as "basic" | "advanced" })}>
        <option value="basic">Basic</option><option value="advanced">Advanced</option></select></label>
      <label>Position <select aria-label="Browse F2L position" value={context.position} onChange={event => onChange({ ...context, position: event.target.value as typeof context.position })}>
        {F2L_POSITIONS.map(position => <option key={position} value={position}>{position} · {f2lPositionLabel(position)}</option>)}</select></label>
    </> : context ? <label>Set <select aria-label="Browse Training set" value={context.trainingSet} onChange={event => onChange({ ...context, trainingSet: event.target.value as "full" | "2look" })}>
      <option value="full">Full</option><option value="2look">2-Look</option></select></label> : null}
  </div>;
}
