import { Plus } from "lucide-react";
import { FormEvent, useState } from "react";

import { labelOrDefault, PLACE_LABEL_PLACEHOLDER } from "../lib/placeDefaults";
import type { PlaceCreate } from "../types";

type Props = {
  onSubmit: (place: PlaceCreate) => Promise<void>;
};

export function PlaceForm({ onSubmit }: Props) {
  const [displayLabel, setDisplayLabel] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const numericLatitude = Number(latitude);
    const numericLongitude = Number(longitude);

    if (
      !latitude.trim() ||
      !Number.isFinite(numericLatitude) ||
      numericLatitude < -90 ||
      numericLatitude > 90
    ) {
      setError("Enter a latitude between -90 and 90.");
      return;
    }

    if (
      !longitude.trim() ||
      !Number.isFinite(numericLongitude) ||
      numericLongitude < -180 ||
      numericLongitude > 180
    ) {
      setError("Enter a longitude between -180 and 180.");
      return;
    }

    setError("");

    try {
      await onSubmit({
        display_label: labelOrDefault(displayLabel, {
          latitude: numericLatitude,
          longitude: numericLongitude,
        }),
        latitude: numericLatitude,
        longitude: numericLongitude,
        visit_count: 1,
        sensitivity_class: "normal",
      });

      setDisplayLabel("");
      setLatitude("");
      setLongitude("");
    } catch {
      setError("Unable to add place. Try again.");
    }
  }

  return (
    <section className="panel place-form" aria-labelledby="place-form-title">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Manual entry</p>
          <h2 id="place-form-title">Add a place</h2>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="display-label">Label (optional)</label>
        <input
          id="display-label"
          name="display-label"
          value={displayLabel}
          onChange={(event) => setDisplayLabel(event.target.value)}
          placeholder={PLACE_LABEL_PLACEHOLDER}
        />

        <div className="form-grid">
          <div>
            <label htmlFor="latitude">Latitude</label>
            <input
              id="latitude"
              name="latitude"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="47.621"
            />
          </div>
          <div>
            <label htmlFor="longitude">Longitude</label>
            <input
              id="longitude"
              name="longitude"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="-122.321"
            />
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit">
          <Plus size={18} />
          Add place
        </button>
      </form>
    </section>
  );
}
