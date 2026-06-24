import type { ReactNode } from "react";

import type { SheetState, TabKey } from "../types";

type Props = {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  sheetState: SheetState;
  onSheetStateChange: (state: SheetState) => void;
  tabBadges?: Partial<Record<TabKey, number>>;
  children: ReactNode;
};

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  {
    key: "places",
    label: "Places",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
  },
  {
    key: "analyze",
    label: "Analyze",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
        <circle cx="16" cy="8" r="2.4" />
        <circle cx="8" cy="16" r="2.4" />
      </svg>
    ),
  },
  {
    key: "compare",
    label: "Compare",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 20V10M12 20V4M19 20v-7" />
      </svg>
    ),
  },
  {
    key: "export",
    label: "Export",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
      </svg>
    ),
  },
];

const SNAPS: SheetState[] = ["full", "half", "peek"];

export function BottomSheet({
  activeTab,
  onTabChange,
  sheetState,
  onSheetStateChange,
  tabBadges,
  children,
}: Props) {
  function cycle() {
    const order: SheetState[] = ["peek", "half", "full"];
    onSheetStateChange(order[(order.indexOf(sheetState) + 1) % order.length]);
  }

  return (
    <section className={`mc-sheet is-${sheetState}`} aria-label="Workspace panel">
      <button type="button" className="mc-handle" aria-label="Cycle panel height" onClick={cycle} />
      <div className="mc-snaps" role="group" aria-label="Panel height">
        {SNAPS.map((snap) => (
          <button
            key={snap}
            type="button"
            className={snap === sheetState ? "on" : undefined}
            aria-pressed={snap === sheetState}
            onClick={() => onSheetStateChange(snap)}
          >
            <span>{snap}</span>
            <b />
          </button>
        ))}
      </div>
      <nav className="mc-tabs" role="tablist" aria-label="Workspace sections">
        {TABS.map((tab) => {
          const badge = tabBadges?.[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`mc-tab${activeTab === tab.key ? " is-active" : ""}`}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.icon}
              {tab.label}
              {badge ? <span className="pill">{badge}</span> : null}
            </button>
          );
        })}
      </nav>
      <div className="mc-panels">{children}</div>
    </section>
  );
}
