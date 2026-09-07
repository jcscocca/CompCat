import { useCallback, useEffect, useState } from "react";

import type { ThreadItem } from "./threadItems";
import { loadReportHistory, REPORTS_ERASED_EVENT, saveReportHistory, withoutErasedReports } from "./reportHistory";

/** Bounds conversation memory/DOM; only recent canonical reports persist in tab storage. */
export const THREAD_CAP = 200;
type AnalysisCard = Extract<ThreadItem, { kind: "analysis_card" }>["card"];

export function useThread() {
  const [items, setItems] = useState<ThreadItem[]>(loadReportHistory);
  useEffect(() => saveReportHistory(items), [items]);
  useEffect(() => {
    const removeReports = (event: Event) => {
      const reportIds = (event as CustomEvent<string[]>).detail;
      setItems((current) => withoutErasedReports(current, reportIds));
    };
    window.addEventListener(REPORTS_ERASED_EVENT, removeReports);
    return () => window.removeEventListener(REPORTS_ERASED_EVENT, removeReports);
  }, []);
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
