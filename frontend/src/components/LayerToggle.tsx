import type { LayerKey } from "../types";

const LAYERS: { value: LayerKey; label: string }[] = [
  { value: "reported", label: "Reported incidents" },
  { value: "arrests", label: "Arrests" },
  { value: "calls", label: "911 calls" },
];

/**
 * Global data-layer switch. Lives in the workspace chrome (not a single tab) so Analyze,
 * Compare, and Routes all read and set one shared layer. "reported" is SPD crime reports;
 * "arrests" is SPD arrest records (enforcement activity); "calls" is 911 calls for service.
 */
export function LayerToggle({ layer, onChange }: { layer: LayerKey; onChange: (layer: LayerKey) => void }) {
  return (
    <div className="mc-layertoggle mc-chips" role="group" aria-label="Data layer">
      {LAYERS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`mc-chip${layer === option.value ? " on" : ""}`}
          aria-pressed={layer === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
