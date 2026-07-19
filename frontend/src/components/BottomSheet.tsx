import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { clampWidth, DRAWER_DEFAULT, DRAWER_MIN, DRAWER_PEEK, DRAWER_RESIZE_STEP, DRAWER_WIDE, drawerMax, type DrawerPreset } from "../lib/drawer";

const GRABBER_TAP_SLOP = 6;
const GRABBER_DRAG_THRESHOLD = 40;

type Props = {
  collapsed: boolean;
  widthPx: number;
  onToggleCollapsed: () => void;
  onResize: (px: number) => void;
  onPreset: (preset: DrawerPreset) => void;
  nav?: ReactNode;
  isMobile?: boolean;
  peekHeader?: ReactNode;
  children: ReactNode;
};

const PRESETS: { preset: DrawerPreset; label: string }[] = [
  { preset: "peek", label: "Peek" },
  { preset: "default", label: "Default" },
  { preset: "wide", label: "Wide" },
  { preset: "focus", label: "Focus" },
];

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

export function BottomSheet({
  collapsed,
  widthPx,
  onToggleCollapsed,
  onResize,
  onPreset,
  nav,
  isMobile = false,
  peekHeader,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const grabStartY = useRef<number | null>(null);

  function onGrabberPointerDown(event: PointerEvent<HTMLDivElement>) {
    grabStartY.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onGrabberPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = grabStartY.current;
    grabStartY.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (start === null) return;
    const dy = event.clientY - start;
    if (Math.abs(dy) <= GRABBER_TAP_SLOP) {
      onToggleCollapsed();
    } else if (collapsed && dy <= -GRABBER_DRAG_THRESHOLD) {
      onToggleCollapsed(); // drag up to expand
    } else if (!collapsed && dy >= GRABBER_DRAG_THRESHOLD) {
      onToggleCollapsed(); // drag down to collapse
    }
  }

  function presetPressed(preset: DrawerPreset) {
    if (preset === "peek") return collapsed;
    if (collapsed) return false;
    if (preset === "default") return widthPx === clampWidth(DRAWER_DEFAULT);
    // On narrow viewports the clamped widths can collide (drawerMax === wide === default);
    // when they do the smaller preset wins and the larger ones suppress themselves, so a
    // segmented control only ever marks a single active option.
    if (preset === "wide") {
      return widthPx === clampWidth(DRAWER_WIDE) && clampWidth(DRAWER_WIDE) !== clampWidth(DRAWER_DEFAULT);
    }
    return (
      widthPx === drawerMax() &&
      drawerMax() !== clampWidth(DRAWER_WIDE) &&
      drawerMax() !== clampWidth(DRAWER_DEFAULT)
    );
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
      style={!isMobile && !collapsed ? { width: widthPx } : undefined}
      aria-label="Workspace panel"
    >
      {isMobile ? (
        <>
          <div
            className="mc-grabber"
            role="button"
            tabIndex={0}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            aria-expanded={!collapsed}
            onPointerDown={onGrabberPointerDown}
            onPointerUp={onGrabberPointerUp}
            onPointerCancel={() => { grabStartY.current = null; }}
            onKeyDown={(event) => activateWithKeyboard(event, onToggleCollapsed)}
          >
            <b />
          </div>
          {peekHeader ? <div className="mc-sheet-head">{peekHeader}</div> : null}
        </>
      ) : (
        <>
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
        </>
      )}
      {nav}
      <div className="mc-panels">{children}</div>
    </section>
  );
}
