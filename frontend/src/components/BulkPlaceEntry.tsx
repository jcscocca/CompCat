import { ClipboardList } from "lucide-react";
import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (csvText: string) => Promise<void>;
};

const initialCsvText =
  "display_label,latitude,longitude,visit_count,total_dwell_minutes\n";

export function BulkPlaceEntry({ onSubmit }: Props) {
  const [csvText, setCsvText] = useState(initialCsvText);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try {
      await onSubmit(csvText);
    } catch {
      setError("Unable to import rows. Try again.");
    }
  }

  return (
    <section className="panel bulk-entry" aria-labelledby="bulk-entry-title">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Bulk entry</p>
          <h2 id="bulk-entry-title">Paste a place list</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="bulk-place-list">CSV rows</label>
        <textarea
          id="bulk-place-list"
          name="bulk-place-list"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          rows={7}
        />

        {error ? <p className="error">{error}</p> : null}

        <button type="submit">
          <ClipboardList size={18} />
          Import rows
        </button>
      </form>
    </section>
  );
}
