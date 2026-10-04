import { useState } from "react";
import { useController } from "../../../app/useController";
import type { TrainingAlgorithmPreference, TrainingCatalogueIdentity } from "../../../app/types";

/** Keyed by catalogue identity by its parent, so navigation abandons the editor. */
export function TrainingAlgorithmEditor({ identity, preference, canEdit }: {
  identity: TrainingCatalogueIdentity;
  preference: TrainingAlgorithmPreference | null;
  canEdit: boolean;
}) {
  const controller = useController();
  const [editing, setEditing] = useState(false);
  const [algorithm, setAlgorithm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setEditing(false); setError(null); };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await controller.setTrainingAlgorithmPreference(algorithm, note);
      if (result.success) close(); else setError(result.error ?? "Could not save My algorithm.");
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      const result = await controller.removeTrainingAlgorithmPreference();
      if (result.success) close(); else setError(result.error ?? "Could not remove My algorithm.");
    } finally { setBusy(false); }
  };
  return <div className="training-algorithm-editor">
    {editing ? <form onSubmit={event => { event.preventDefault(); if (canEdit && !busy && algorithm.trim()) void save(); }}
      onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); close(); } }}>
      <label>Algorithm<textarea autoFocus maxLength={1000} rows={3} className="mono" value={algorithm}
        disabled={busy || !canEdit} onChange={event => setAlgorithm(event.target.value)} /></label>
      <p className="small dim">{identity.family === "f2l"
        ? "Saved for the currently selected F2L position."
        : "Enter your algorithm for the case. Training handles AUF automatically."}</p>
      <label>Note (optional)<textarea maxLength={240} rows={2} value={note} disabled={busy || !canEdit}
        onChange={event => setNote(event.target.value)} /></label>
      <div className="row wrap">
        <button type="submit" disabled={busy || !canEdit || !algorithm.trim()}>Save algorithm</button>
        <button type="button" className="ghost" disabled={busy} onClick={close}>Cancel</button>
      </div>
    </form> : <div className="row wrap training-algorithm-actions">
      <button type="button" className="ghost small" disabled={busy || !canEdit} onClick={() => {
        setAlgorithm(preference?.algorithm ?? ""); setNote(preference?.note ?? ""); setError(null); setEditing(true);
      }}>{preference ? "Edit" : "Set custom algorithm"}</button>
      {preference ? <button type="button" className="ghost small" disabled={busy || !canEdit} onClick={() => void remove()}>Remove</button> : null}
    </div>}
    {error ? <p className="small error" role="alert">{error}</p> : null}
  </div>;
}

/** Pure card presentation; subscriptions belong to catalogue panels. */
export function TrainingMyAlgorithmMarker() {
  return <span className="training-my-alg-marker" aria-label="My algorithm saved">★ My alg</span>;
}
