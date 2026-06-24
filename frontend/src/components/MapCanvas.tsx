import * as L from "leaflet";
import { Fragment, useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { incidentCountForPlace } from "../lib/incidentSummaries";
import type { TileConfig } from "../lib/mapTiles";
import type { DashboardSummary, DraftPin, LatLng, Place } from "../types";

const SEATTLE: [number, number] = [47.6062, -122.3321];

type MarkerKind = "default" | "selected" | "analyzed" | "low";

const DOT = '<circle cx="12" cy="11.5" r="4.4" fill="#fff"/>';
const QGLYPH = '<text x="12" y="16" font-size="13" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">?</text>';

function teardrop(fill: string, glyph: string): string {
  return `<svg width="28" height="36" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="${fill}"/>${glyph}</svg>`;
}

function iconHtml(kind: MarkerKind, opts: { count?: number | null; label?: string }): string {
  if (kind === "selected") {
    return `<span class="mc-pin-halo"></span>${teardrop("#CD6A45", DOT)}<span class="mc-pin-tag">${opts.label ?? ""}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop("#3A3F46", DOT)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  if (kind === "low") {
    return teardrop("#74858E", QGLYPH);
  }
  return teardrop("#3A3F46", DOT);
}

function makeIcon(kind: MarkerKind, opts: { count?: number | null; label?: string } = {}): L.DivIcon {
  return L.divIcon({ className: "mc-pin-icon", html: iconHtml(kind, opts), iconSize: [28, 36], iconAnchor: [14, 36] });
}

const DRAFT_ICON = L.divIcon({
  className: "mc-pin-icon mc-pin-draft",
  html: teardrop("#B5512F", DOT),
  iconSize: [28, 36],
  iconAnchor: [14, 36],
});

function MapClickHandler({ onMapClick }: { onMapClick: (latlng: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onMapClick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15));
    }
  }, [target, map]);
  return null;
}

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  draft: DraftPin | null;
  addPinMode: boolean;
  summary: DashboardSummary | null;
  radiusM: number;
  flyTo: LatLng | null;
  tileConfig: TileConfig;
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  radiusM,
  flyTo,
  tileConfig,
  onMapClick,
  onMarkerClick,
}: Props) {
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;

  function kindFor(place: Place): MarkerKind {
    if (incidentCountForPlace(summary, place.id, radiusM) !== null) {
      return "analyzed";
    }
    if (analyzedAtRadius && selectedIds.has(place.id)) {
      return "low";
    }
    if (selectedIds.has(place.id)) {
      return "selected";
    }
    return "default";
  }

  return (
    <MapContainer
      center={SEATTLE}
      zoom={12}
      className={`mc-map${addPinMode ? " is-adding" : ""}`}
      zoomControl={false}
      attributionControl
    >
      <TileLayer url={tileConfig.url} attribution={tileConfig.attribution} maxZoom={tileConfig.maxZoom} />
      <MapClickHandler onMapClick={onMapClick} />
      <FlyTo target={flyTo} />
      {places.map((place) => {
        if (place.latitude === null || place.longitude === null) {
          return null;
        }
        const position: [number, number] = [place.latitude, place.longitude];
        const kind = kindFor(place);
        const count = incidentCountForPlace(summary, place.id, radiusM);
        return (
          <Fragment key={place.id}>
            {kind === "analyzed" ? (
              <Circle center={position} radius={radiusM} pathOptions={{ color: "#CD6A45", weight: 1.5, fillColor: "#CD6A45", fillOpacity: 0.15 }} />
            ) : null}
            {kind === "low" ? (
              <Circle center={position} radius={radiusM} pathOptions={{ color: "#74858E", weight: 1.5, dashArray: "4 4", fillColor: "#74858E", fillOpacity: 0.12 }} />
            ) : null}
            <Marker
              position={position}
              icon={makeIcon(kind, { count, label: place.display_label })}
              eventHandlers={{ click: () => onMarkerClick(place.id) }}
            />
          </Fragment>
        );
      })}
      {draft ? <Marker position={[draft.latitude, draft.longitude]} icon={DRAFT_ICON} /> : null}
    </MapContainer>
  );
}
