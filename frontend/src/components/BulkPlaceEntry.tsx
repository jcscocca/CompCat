import { ClipboardList } from "lucide-react";
import { FormEvent, useState } from "react";

type Props = {
  onSubmit: (csvText: string) => Promise<void>;
};

const initialCsvText =
  "display_label,latitude,longitude\n";

export function BulkPlaceEntry({ onSubmit }: Props) {
  const [csvText, setCsvText] = useState(initialCsvText);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    try {
      await onSubmit(csvText);
    } catch {
      setError("Unable to import places. Try again.");
    }
  }

  return (
    <section className="panel bulk-entry" aria-labelledby="bulk-entry-title">
      <div className="panel-heading">
        <h2 id="bulk-entry-title">Paste a place list</h2>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="bulk-place-list">Place rows (label, lat, lon)</label>
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
          Import places
        </button>
      </form>
    </section>
  );
}
