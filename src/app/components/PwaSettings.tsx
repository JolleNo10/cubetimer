import { usePwaUpdate } from "../usePwaUpdate";

/** Presentation only; Controller and the update module decide reload safety. */
export function PwaSettings() {
  const pwa = usePwaUpdate();
  const labels = {
    development: "Development: offline caching disabled.",
    unavailable: "Offline installation is unavailable in this browser.",
    registering: "Registering offline support...",
    error: "Offline installation could not start.",
    registered: pwa.offlineReady ? "Offline files installed." : pwa.error ? "Offline files are not installed yet." : "Installing offline files...",
  };
  return <>
    <p className="small faint">
      After the offline files finish installing online, Cubetimer works without internet.
      Bluetooth stays local. On iPhone, use Bluefy for smart-cube connections;
      Safari and Safari Home Screen apps do not provide Web Bluetooth.
    </p>
    <p className="small" role="status">
      {labels[pwa.status]}
      {pwa.updateAvailable ? " Update available." : ""}
      {pwa.pending ? " Update queued until activity and saving finish." : ""}
    </p>
    {pwa.error ? <p className="small" role="alert">{pwa.error}</p> : null}
    <div className="row wrap">
      <button disabled={(pwa.status !== "registered" && pwa.status !== "error") || pwa.checking}
        onClick={() => void pwa.checkForUpdate()}>{pwa.checking ? "Checking..." : "Check for update"}</button>
      {pwa.updateAvailable ? <button disabled={pwa.pending} onClick={pwa.applyUpdate}>
        {pwa.pending ? "Update queued" : "Apply update"}
      </button> : null}
    </div>
    <p className="small faint">History is stored in this browser. Export a JSON backup regularly,
      especially on iOS, where browser data may be removed by the system. Updates never erase your history.</p>
  </>;
}
