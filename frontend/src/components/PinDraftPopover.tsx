import type { FormEvent } from "react";

import { PLACE_LABEL_PLACEHOLDER } from "../lib/placeDefaults";
import type { DraftPin } from "../types";

type Props = {
  draft: DraftPin;
  saving: boolean;
  error?: string;
  autoFocus?: boolean;
  onChange: (patch: Partial<DraftPin>) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function PinDraftPopover({ draft, saving, error, autoFocus = false, onChange, onSave, onCancel }: Props) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }

  return (
    <form className="mc-draft" aria-labelledby="draft-pin-title" onSubmit={handleSubmit}>
      <div className="mc-draft-head">
        <span className="mc-draft-marker" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
        </span>
        <div>
          <h2 className="mc-draft-title" id="draft-pin-title">Name this pin</h2>
          <p className="mc-draft-coord">
            {draft.source === "map" ? "Dropped on the map" : "Found by search"} · {draft.latitude.toFixed(4)}, {draft.longitude.toFixed(4)}
          </p>
        </div>
      </div>
      <label htmlFor="draft-label">Pin label <span>(optional)</span></label>
      <input
        id="draft-label"
        value={draft.display_label}
        placeholder={PLACE_LABEL_PLACEHOLDER}
        autoFocus={autoFocus}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? "draft-pin-hint draft-pin-error" : "draft-pin-hint"}
        onChange={(event) => onChange({ display_label: event.target.value })}
      />
      <p className="mc-draft-hint" id="draft-pin-hint">Names are optional. You can rename this place later.</p>
      {error ? <p className="mc-draft-error" id="draft-pin-error" role="alert">{error}</p> : null}
      <div className="mc-draft-actions">
        <button type="button" className="mc-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="mc-cta" disabled={saving}>
          {saving ? "Saving..." : "Save pin"}
        </button>
      </div>
    </form>
  );
}
