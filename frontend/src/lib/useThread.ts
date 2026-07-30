import { useCallback, useState } from "react";

import type { ThreadItem } from "./threadItems";

/** Session-scoped cap — the thread is not persisted, this just bounds memory/DOM. */
export const THREAD_CAP = 200;
type AnalysisCard = Extract<ThreadItem, { kind: "analysis_card" }>["card"];

export function useThread() {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const append = useCallback((item: ThreadItem) => {
    setItems((current) => {
      const next = [...current, item];
      return next.length > THREAD_CAP ? next.slice(next.length - THREAD_CAP) : next;
    });
  }, []);
  const replaceAnalysisCard = useCallback((previousCard: AnalysisCard | null, card: AnalysisCard) => {
    setItems((current) => {
      const withoutPrevious = previousCard
        ? current.filter((item) => item.kind !== "analysis_card" || item.card !== previousCard)
        : current;
      const next: ThreadItem[] = [...withoutPrevious, { kind: "analysis_card", card }];
      return next.length > THREAD_CAP ? next.slice(next.length - THREAD_CAP) : next;
    });
  }, []);
  return { items, append, replaceAnalysisCard };
}
