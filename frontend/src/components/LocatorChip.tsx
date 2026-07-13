import { useMemo } from "react";

import { CHIP_H, CHIP_W, featurePath, project, type LocatorBox } from "../lib/locatorGeometry";
import type { PlaceIdentity } from "../lib/placeIdentity";
import type { McppFeatureCollection } from "../types";

export type LocatorData = { polygons: McppFeatureCollection; box: LocatorBox; mosaic: string };

type Props = {
  locator: LocatorData;
  latitude: number;
  longitude: number;
  /** Display label of the place's MCPP baseline entry (e.g. "Test Hill"); null when the
   * place resolved to no neighborhood. Uppercasing recovers the canonical polygon name —
   * every display label (title-cased or acronym override) round-trips. */
  mcppLabel: string | null;
  identity: PlaceIdentity;
  /** When provided, the chip renders as a button that flies the map to this place. */
  onActivate?: () => void;
};

export function LocatorChip({ locator, latitude, longitude, mcppLabel, identity, onActivate }: Props) {
  const highlight = useMemo(
    () => (mcppLabel ? featurePath(locator.polygons, mcppLabel.toUpperCase(), locator.box) : ""),
    [locator, mcppLabel],
  );
  const [cx, cy] = project(longitude, latitude, locator.box);
  const svg = (
    <svg
      className={`mc-locator id-${identity.slot}`}
      viewBox={`0 0 ${CHIP_W} ${CHIP_H}`}
      width={CHIP_W}
      height={CHIP_H}
      role={onActivate ? undefined : "img"}
      aria-hidden={onActivate ? "true" : undefined}
      aria-label={
        onActivate
          ? undefined
          : mcppLabel
            ? `${identity.letter} is in ${mcppLabel}`
            : `Location of ${identity.letter} in Seattle`
      }
      data-testid="locator-chip"
    >
      <path className="mosaic" d={locator.mosaic} />
      {highlight ? <path className="hood" d={highlight} data-testid="locator-highlight" /> : null}
      <circle className="pin" cx={cx} cy={cy} r={3.5} />
    </svg>
  );

  if (!onActivate) return svg;

  return (
    <button
      type="button"
      className="mc-locator-btn"
      onClick={onActivate}
      aria-label={mcppLabel ? `Fly the map to ${identity.letter} in ${mcppLabel}` : `Fly the map to ${identity.letter}`}
    >
      {svg}
    </button>
  );
}
