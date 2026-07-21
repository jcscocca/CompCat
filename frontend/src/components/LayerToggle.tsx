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
            title={unavailable ? `${option.label} data is not loaded` : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {unavailable ? <span className="mc-layer-unavailable" aria-hidden="true">No data</span> : null}
          </button>
        );
      })}
    </div>
  );
}
