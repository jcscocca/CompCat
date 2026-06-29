import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { createPlace } from "../api/client";
import { labelOrDefault } from "./placeDefaults";
import type { DraftPin, GeocodeResult, LatLng } from "../types";

export interface PinDraftController {
  addPinMode: boolean;
  draft: DraftPin | null;
  draftSaving: boolean;
  draftError: string;
  flyTo: LatLng | null;
  setAddPinMode: (on: boolean) => void;
  setDraft: Dispatch<SetStateAction<DraftPin | null>>;
  startAddPin: () => void;
  handleMapClick: (latlng: LatLng) => void;
  handleSearchSelect: (result: GeocodeResult) => void;
  saveDraft: () => Promise<void>;
}

interface PinDraftDeps {
  selectPlaceIds: (ids: string[]) => void;
  refreshWithFallback: (fallbackMessage: string) => Promise<void>;
  setActiveTab: (tab: "places") => void;
  setDrawerCollapsed: (collapsed: boolean) => void;
}

/**
 * Owns the "add a place pin" flow on the map: arming add-pin mode, the in-progress draft
 * (from a map click or an address search), saving it as a place, and the Esc-to-cancel
 * key handler. Drives the shared selection/drawer/tab via the injected callbacks.
 */
export function usePinDraft({
  selectPlaceIds,
  refreshWithFallback,
  setActiveTab,
  setDrawerCollapsed,
}: PinDraftDeps): PinDraftController {
  const [addPinMode, setAddPinMode] = useState(false);
  const [draft, setDraft] = useState<DraftPin | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [flyTo, setFlyTo] = useState<LatLng | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddPinMode(false);
        setDraft(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function startAddPin() {
    setAddPinMode(true);
    setActiveTab("places");
    setDrawerCollapsed(true);
  }

  function handleMapClick(latlng: LatLng) {
    if (!addPinMode) return;
    setDraft({
      latitude: latlng.lat,
      longitude: latlng.lng,
      display_label: "",
      visit_count: 1,
      sensitivity_class: "normal",
      source: "map",
    });
    setDraftError("");
    setAddPinMode(false);
    setActiveTab("places");
    setDrawerCollapsed(false);
  }

  function handleSearchSelect(result: GeocodeResult) {
    setDraft({
      latitude: result.latitude,
      longitude: result.longitude,
      display_label: result.label,
      visit_count: 1,
      sensitivity_class: "normal",
      source: "search",
    });
    setFlyTo({ lat: result.latitude, lng: result.longitude });
    setDraftError("");
    setActiveTab("places");
  }

  async function saveDraft() {
    if (!draft) return;
    setDraftSaving(true);
    setDraftError("");
    try {
      const created = await createPlace({
        display_label: labelOrDefault(draft.display_label),
        latitude: draft.latitude,
        longitude: draft.longitude,
        visit_count: 1,
        sensitivity_class: draft.sensitivity_class,
      });
      selectPlaceIds([created.id]);
      setDraft(null);
      await refreshWithFallback("Saved, but dashboard totals could not refresh.");
    } catch {
      setDraftError("Unable to save pin. Try again.");
    } finally {
      setDraftSaving(false);
    }
  }

  return {
    addPinMode,
    draft,
    draftSaving,
    draftError,
    flyTo,
    setAddPinMode,
    setDraft,
    startAddPin,
    handleMapClick,
    handleSearchSelect,
    saveDraft,
  };
}
