import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { clampWidth, DRAWER_DEFAULT, DRAWER_MIN, DRAWER_PEEK, DRAWER_RESIZE_STEP, DRAWER_WIDE, drawerMax, type DrawerPreset } from "../lib/drawer";
import type { TabKey } from "../types";

type Props = {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  collapsed: boolean;
  widthPx: number;
  onToggleCollapsed: () => void;
  onResize: (px: number) => void;
  onPreset: (preset: DrawerPreset) => void;
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

const PRESETS: { preset: DrawerPreset; label: string }[] = [
  { preset: "peek", label: "Peek" },
  { preset: "default", label: "Default" },
  { preset: "wide", label: "Wide" },
];

function activateWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function BottomSheet({
  activeTab,
  onTabChange,
  collapsed,
  widthPx,
  onToggleCollapsed,
  onResize,
  onPreset,
  tabBadges,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);

  function presetPressed(preset: DrawerPreset) {
    if (preset === "peek") return collapsed;
    if (collapsed) return false;
    if (preset === "default") return widthPx === clampWidth(DRAWER_DEFAULT);
    // On narrow viewports clampWidth(WIDE) can equal clampWidth(DEFAULT); when they
    // collide the shared width reads as "default", so the two presets are never both
    // marked pressed (a segmented control must have a single active option).
    return widthPx === clampWidth(DRAWER_WIDE) && clampWidth(DRAWER_WIDE) !== clampWidth(DRAWER_DEFAULT);
  }

  function onHandlePointerDown(event: PointerEvent<HTMLDivElement>) {
    moved.current = false;
    if (collapsed) {
      dragging.current = false;
      return;
    }
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onHandlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !panelRef.current) return;
    moved.current = true;
    const right = panelRef.current.getBoundingClientRect().right;
    onResize(right - event.clientX);
  }

  function onHandlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const wasDragging = dragging.current;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (collapsed) {
      onToggleCollapsed();
      return;
    }
    if (wasDragging && !moved.current) onToggleCollapsed();
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleCollapsed();
      return;
    }
    if (collapsed) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(widthPx + DRAWER_RESIZE_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onResize(widthPx - DRAWER_RESIZE_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      onResize(drawerMax());
    } else if (event.key === "End") {
      event.preventDefault();
      onResize(DRAWER_MIN);
    }
  }

  return (
    <section
      ref={panelRef}
      className={`mc-workspace-panel ${collapsed ? "is-collapsed" : "is-open"}`}
      style={collapsed ? undefined : { width: widthPx }}
      aria-label="Workspace panel"
    >
      <div
        className="mc-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace panel"
        aria-valuemin={DRAWER_PEEK}
        aria-valuemax={drawerMax()}
        aria-valuenow={collapsed ? DRAWER_PEEK : widthPx}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={onHandleKeyDown}
      />
      <div className="mc-snaps" role="group" aria-label="Panel size">
        {PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            className={presetPressed(preset) ? "on" : undefined}
            aria-pressed={presetPressed(preset)}
            onClick={() => onPreset(preset)}
            onKeyDown={(event) => activateWithKeyboard(event, () => onPreset(preset))}
          >
            <span>{label}</span>
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
              onKeyDown={(event) => activateWithKeyboard(event, () => onTabChange(tab.key))}
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
