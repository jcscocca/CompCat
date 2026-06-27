import { useState } from "react";
import { deletePersonalData, uploadPersonalData } from "../api/client";

type Props = { onUploaded: () => void };

export function PersonalUpload({ onUploaded }: Props) {
  const [consented, setConsented] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await uploadPersonalData(file);
      setStatus(
        `Created ${result.place_cluster_count} place${result.place_cluster_count === 1 ? "" : "s"} from your history.`,
      );
      onUploaded();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    setBusy(true);
    try {
      await deletePersonalData();
      setStatus("Your uploaded data was deleted.");
      onUploaded();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mc-upload">
      <p className="mc-upload-consent">
        Your location history is processed in your session into a small set of approximate
        place clusters. By default the raw points and individual stops are discarded
        immediately — only the clusters are kept, and you can delete everything anytime.
      </p>
      <p className="mc-upload-caveat">
        Waypoint shows reported-incident context near these places. It never claims you were
        present at any incident and does not score safety.
      </p>
      <label className="mc-upload-check">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => setConsented(event.target.checked)}
        />{" "}
        I understand and want to continue.
      </label>
      <input
        type="file"
        accept=".json,.csv,.geojson,.gpx"
        aria-label="Location history file"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="mc-upload-actions">
        <button type="button" disabled={!consented || !file || busy} onClick={submit}>
          Upload
        </button>
        <button type="button" disabled={busy} onClick={removeAll}>
          Delete my uploaded data
        </button>
      </div>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}
