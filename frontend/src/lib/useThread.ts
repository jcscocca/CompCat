import { useCallback, useState } from "react";

import type { ThreadItem } from "./threadItems";

/** Session-scoped cap — the thread is not persisted, this just bounds memory/DOM. */
export const THREAD_CAP = 200;

export function useThread() {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const append = useCallback((item: ThreadItem) => {
    setItems((current) => {
      const next = [...current, item];
      return next.length > THREAD_CAP ? next.slice(next.length - THREAD_CAP) : next;
    });
  }, []);
  return { items, append };
}
