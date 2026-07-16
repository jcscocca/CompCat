import { useEffect, useRef, useState } from "react";

import type { Place } from "../types";

export type AddressEntry = {
  latitude: number;
  longitude: number;
  label: string;
  /** Present when this entry is one of the user's saved places. */
  savedPlaceId?: string;
};

export const MAX_ADDRESSES = 10;

/** @deprecated slice-2 transition aliases — removed in the cleanup task. */
export type ComparePoint = AddressEntry;
export const MAX_COMPARE_POINTS = MAX_ADDRESSES;

export interface AddressList {
  entries: AddressEntry[];
  add: (entry: AddressEntry) => void;
  removeAt: (index: number) => void;
  /** Add the saved place as an entry, or remove its entry if present. */
  toggleSaved: (place: Place) => void;
  /** Swap the whole list (share links, lookup, assistant). Counts as an edit. */
  replaceAll: (entries: AddressEntry[]) => void;
  /** Stamp a savedPlaceId onto the entry matching keyOf (opt-in Save flow). */
  markSaved: (key: string, savedPlaceId: string) => void;
  /** Saved-place ids currently in the list, in list order. */
  savedIds: () => string[];
  /** True once the user (or a programmatic replace) has edited the list — seeding no longer applies. */
  edited: boolean;
}

export function keyOf(p: { latitude: number; longitude: number }): string {
  return `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
}

function normalize(entry: AddressEntry): AddressEntry {
  // Backend generalizes saved coords to ~3 decimals for privacy; normalizing here keeps
  // keyOf matches (Saved badges, dedupe) stable across the save round-trip.
  return { ...entry, latitude: Number(entry.latitude.toFixed(3)), longitude: Number(entry.longitude.toFixed(3)) };
}

function dedupeCap(entries: AddressEntry[]): AddressEntry[] {
  const seen = new Set<string>();
  const out: AddressEntry[] = [];
  for (const e of entries) {
    const k = keyOf(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
}

/** Convert saved places to entries, dropping null coords, de-duped and capped. */
export function entriesFromPlaces(places: Place[]): AddressEntry[] {
  const entries: AddressEntry[] = [];
  for (const place of places) {
    if (place.latitude == null || place.longitude == null) continue;
    entries.push(normalize({ latitude: place.latitude, longitude: place.longitude, label: place.display_label, savedPlaceId: place.id }));
  }
  return dedupeCap(entries);
}

/** @deprecated transition alias — removed in the cleanup task. */
export const pointsFromPlaces = entriesFromPlaces;

interface AddressListDeps {
  /** Saved places to seed from (the restored persisted selection). Re-seeds until the first edit. */
  seed: Place[];
  /** Called with the list's saved ids after every post-seed change (selection persistence). */
  onSavedIdsChange?: (ids: string[]) => void;
}

function sameEntries(a: AddressEntry[], b: AddressEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => keyOf(e) === keyOf(b[i]) && e.label === b[i].label && e.savedPlaceId === b[i].savedPlaceId);
}

/**
 * The workspace's single address list (1–MAX_ADDRESSES entries, saved or ad-hoc). Seeds
 * synchronously from the restored saved selection and re-seeds on seed changes until the
 * user's first manual edit — after that the list is theirs. Saved ids are reported
 * outward on every change so the returning-session selection stays persisted.
 */
export function useAddressList({ seed, onSavedIdsChange }: AddressListDeps): AddressList {
  const editedRef = useRef(false);
  const [entries, setEntries] = useState<AddressEntry[]>(() => entriesFromPlaces(seed));

  // Re-seed (content-compared, so identical seeds don't churn renders) until first edit.
  useEffect(() => {
    if (editedRef.current) return;
    setEntries((cur) => {
      const next = entriesFromPlaces(seed);
      return sameEntries(cur, next) ? cur : next;
    });
  }, [seed]);

  // Notify saved-id changes from an effect (functional updaters below can't call out),
  // deduped so persistence writes only when membership actually changed.
  const onSavedIdsChangeRef = useRef(onSavedIdsChange);
  onSavedIdsChangeRef.current = onSavedIdsChange;
  const lastSavedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Seeding must not write back: a pre-restore notify would mark the persisted
    // selection dirty and skip the returning-session restore entirely.
    if (!editedRef.current) return;
    const ids = entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
    const key = ids.join("|");
    if (key === lastSavedKeyRef.current) return;
    lastSavedKeyRef.current = key;
    onSavedIdsChangeRef.current?.(ids);
  }, [entries]);

  // All mutations use functional updates so same-tick batches (bulk import, multi-id
  // selection) compose instead of clobbering each other.
  function add(entry: AddressEntry) {
    editedRef.current = true;
    setEntries((cur) => dedupeCap([...cur, normalize(entry)]));
  }

  function removeAt(index: number) {
    editedRef.current = true;
    setEntries((cur) => cur.filter((_, i) => i !== index));
  }

  function toggleSaved(place: Place) {
    if (place.latitude == null || place.longitude == null) return;
    editedRef.current = true;
    setEntries((cur) => {
      const existing = cur.findIndex((e) => e.savedPlaceId === place.id);
      if (existing >= 0) return cur.filter((_, i) => i !== existing);
      const entry = normalize({ latitude: place.latitude as number, longitude: place.longitude as number, label: place.display_label, savedPlaceId: place.id });
      const collision = cur.findIndex((e) => keyOf(e) === keyOf(entry));
      if (collision >= 0) {
        // Address already in the list ad-hoc: stamp it saved in place (toggle-off then removes it whole).
        return cur.map((e, i) => (i === collision ? { ...e, label: entry.label, savedPlaceId: entry.savedPlaceId } : e));
      }
      return dedupeCap([...cur, entry]);
    });
  }

  function replaceAll(next: AddressEntry[]) {
    editedRef.current = true;
    setEntries(dedupeCap(next.map(normalize)));
  }

  // Deliberately not an edit: stamping an id must not stop re-seeding.
  function markSaved(key: string, savedPlaceId: string) {
    setEntries((cur) => cur.map((e) => (keyOf(e) === key ? { ...e, savedPlaceId } : e)));
  }

  function savedIds() {
    return entries.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
  }

  return { entries, add, removeAt, toggleSaved, replaceAll, markSaved, savedIds, edited: editedRef.current };
}

/**
 * @deprecated slice-2 transition shim for the old CompareSet consumers; removed in the
 * cleanup task once MapWorkspace is on useAddressList.
 */
export interface CompareSet {
  points: AddressEntry[];
  add: (point: AddressEntry) => void;
  removeAt: (index: number) => void;
}

/** @deprecated transition shim — removed in the cleanup task. */
export function useCompareSet(seed: Place[]): CompareSet {
  const list = useAddressList({ seed });
  return { points: list.entries, add: list.add, removeAt: list.removeAt };
}
