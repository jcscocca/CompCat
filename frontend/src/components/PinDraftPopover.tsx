import type { FormEvent } from "react";

import { PLACE_LABEL_PLACEHOLDER } from "../lib/placeDefaults";
import type { DraftPin } from "../types";

type Props = {
  draft: DraftPin;
  saving: boolean;
  error?: string;
  onChange: (patch: Partial<DraftPin>) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function PinDraftPopover({ draft, saving, error, onChange, onSave, onCancel }: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }

  return (
    <form className="mc-draft" aria-label="New pin details" onSubmit={handleSubmit}>
      <div className="mc-draft-head">
        <span className="mc-draft-title">New pin</span>
        <span className="mc-draft-coord">
          {draft.latitude.toFixed(4)}, {draft.longitude.toFixed(4)} · from {draft.source}
        </span>
      </div>
      <label htmlFor="draft-label">Label (optional)</label>
      <input
        id="draft-label"
        value={draft.display_label}
        placeholder={PLACE_LABEL_PLACEHOLDER}
        onChange={(event) => onChange({ display_label: event.target.value })}
      />
      {error ? <p className="mc-draft-error" role="alert">{error}</p> : null}
      <div className="mc-draft-actions">
        <button type="button" className="mc-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="mc-cta" disabled={saving}>
          {saving ? "Saving..." : "Save pin"}
        </button>
      </div>
    </form>
  );
}
