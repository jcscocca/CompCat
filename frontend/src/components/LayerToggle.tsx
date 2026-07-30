import type { LayerKey } from "../types";

const LAYERS: { value: LayerKey; label: string }[] = [
  { value: "reported", label: "Reported incidents" },
  { value: "arrests", label: "Arrests" },
  { value: "calls", label: "911 calls" },
];

/**
 * Global data-layer switch. Lives in the workspace chrome (not a single tab) so Analyze
 * and Compare all read and set one shared layer. "reported" is SPD crime reports;
 * "arrests" is SPD arrest records (enforcement activity); "calls" is 911 calls for service.
 */
export function LayerToggle({
  layer,
  onChange,
  availability,
}: {
  layer: LayerKey;
  onChange: (layer: LayerKey) => void;
  /** False means the freshness endpoint confirmed that this layer has no loaded rows. */
  availability?: Partial<Record<LayerKey, boolean>>;
}) {
  return (
    <div className="mc-layertoggle mc-chips" role="group" aria-label="Data layer">
      {LAYERS.map((option) => {
        const unavailable = availability?.[option.value] === false;
        return (
          <button
            key={option.value}
            type="button"
            className={`mc-chip${layer === option.value ? " on" : ""}`}
            aria-pressed={layer === option.value}
            disabled={unavailable}
            // Includes the visible "No data" text so the accessible name still contains the
            // label a speech-input user would say (SC 2.5.3).
            aria-label={unavailable ? `${option.label} — No data loaded` : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {unavailable ? <span className="mc-layer-unavailable">No data</span> : null}
          </button>
        );
      })}
    </div>
  );
}
