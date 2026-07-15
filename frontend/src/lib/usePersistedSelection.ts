import { useCallback, useRef, useState } from "react";

import type { Place } from "../types";

// All persisted UI state uses the compcat.* storage brand.
const STORAGE_KEY = "compcat.selection";

function loadStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function save(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // private mode / disabled storage: selection degrades to per-session
  }
}

// Owns the drawer's selected-place ids: restores the persisted set once when places
// first arrive (filtered to ids that still exist, falling back to ALL places so a
// returning session always has an analyzable selection), persists every change after.
export function usePersistedSelection(places: Place[]) {
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(new Set());
  const restoredRef = useRef(false);
  const preRestoreUpdateRef = useRef(false);

  if (!restoredRef.current && places.length > 0) {
    restoredRef.current = true;
    if (!preRestoreUpdateRef.current) {
      const existing = new Set(places.map((p) => p.id));
      const valid = loadStored().filter((id) => existing.has(id));
      setSelectedIdsState(new Set(valid.length > 0 ? valid : places.map((p) => p.id)));
    }
  }

  const setSelectedIds = useCallback((next: Set<string> | ((current: Set<string>) => Set<string>)) => {
    if (!restoredRef.current) preRestoreUpdateRef.current = true;
    setSelectedIdsState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      if (restoredRef.current) save(resolved);
      return resolved;
    });
  }, []);

  return { selectedIds, setSelectedIds, restored: restoredRef.current };
}
