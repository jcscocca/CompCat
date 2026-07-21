import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { DRAWER_MIN, DRAWER_RESIZE_STEP, drawerMax, SHEET_SNAPS, snapHeightPx } from "../lib/drawer";
import type { SheetSnap } from "../types";
import { TabbyAvatar } from "./TabbyAvatar";

const GRABBER_TAP_SLOP = 6;
// Fast flick past which the release biases one snap in the drag direction.
const GRABBER_FLICK = 0.5; // px/ms

type Props = {
  collapsed: boolean;
  widthPx: number;
  onToggleCollapsed: () => void;
  onResize: (px: number) => void;
  isMobile?: boolean;
  peekHeader?: ReactNode;
  /** Mobile-only: current sheet snap; defaults to bar/half from `collapsed` until wired. */
  snap?: SheetSnap;
  /** Mobile-only: commit a snap after a grabber drag. No-op on desktop. */
  onSnap?: (snap: SheetSnap) => void;
  children: ReactNode;
};

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
  isMobile = false,
  peekHeader,
  snap,
  onSnap,
  children,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const dragState = useRef<{ startY: number; startT: number; startHeight: number } | null>(null);

  const effectiveSnap: SheetSnap = snap ?? (collapsed ? "bar" : "half");

  function onGrabberPointerDown(event: PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    dragState.current = { startY: event.clientY, startT: performance.now(), startHeight: panel.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onGrabberPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    const panel = panelRef.current;
    if (!drag || !panel) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) <= GRABBER_TAP_SLOP) return;
    const height = Math.max(80, Math.min(window.innerHeight * 0.95, drag.startHeight - dy));
    panel.style.height = `${height}px`; // live drag, uncommitted
  }

  function onGrabberPointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    const panel = panelRef.current;
    dragState.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!drag || !panel) return;
    panel.style.height = ""; // hand height back to the snap class
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) <= GRABBER_TAP_SLOP) {
      onToggleCollapsed(); // tap: bar ↔ last expanded (useDrawer owns the memory)
      return;
    }
    const dt = Math.max(1, performance.now() - drag.startT);
    const velocity = dy / dt; // px/ms; positive = downward
    const endHeight = drag.startHeight - dy;
    const vh = window.innerHeight;
    const candidates: { snap: SheetSnap; h: number }[] = SHEET_SNAPS.map((snap) => ({ snap, h: snapHeightPx(snap, vh) }));
    let nearest = candidates.reduce((a, b) => (Math.abs(b.h - endHeight) < Math.abs(a.h - endHeight) ? b : a));
    const index = candidates.findIndex((c) => c.snap === nearest.snap);
    if (velocity > GRABBER_FLICK) {
      nearest = candidates[Math.max(0, index - 1)]; // fast downward flick: one snap lower
    } else if (velocity < -GRABBER_FLICK) {
      nearest = candidates[Math.min(candidates.length - 1, index + 1)]; // fast upward flick: one snap higher
    }
    onSnap?.(nearest.snap);
  }

  function onGrabberPointerCancel(event: PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (panelRef.current) panelRef.current.style.height = "";
  }

  useEffect(() => {
    if (!isMobile || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const panel = panelRef.current;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel?.style.setProperty("--kb-inset", `${inset}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      panel?.style.removeProperty("--kb-inset");
    };
  }, [isMobile]);

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
      className={`mc-workspace-panel ${isMobile ? `is-${effectiveSnap}` : collapsed ? "is-collapsed" : "is-open"}`}
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
            onPointerMove={onGrabberPointerMove}
            onPointerUp={onGrabberPointerUp}
            onPointerCancel={onGrabberPointerCancel}
            onKeyDown={(event) => activateWithKeyboard(event, onToggleCollapsed)}
          >
            <b />
          </div>
          {peekHeader ? <div className="mc-sheet-head">{peekHeader}</div> : null}
        </>
      ) : (
        <>
          {collapsed ? (
            <button type="button" className="mc-pane-tab" aria-label="Expand Tabby pane" onClick={onToggleCollapsed}>
              <TabbyAvatar variant="mark" size={22} />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          ) : (
            <div
              className="mc-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize workspace panel"
              aria-valuemin={DRAWER_MIN}
              aria-valuemax={drawerMax()}
              aria-valuenow={widthPx}
              tabIndex={0}
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={() => { dragging.current = false; }}
              onKeyDown={onHandleKeyDown}
            />
          )}
        </>
      )}
      <div className="mc-panels">{children}</div>
    </section>
  );
}
