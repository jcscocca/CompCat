import { useRef, useState } from "react";

import type { TabKey } from "../types";

export type RailView = "tabby" | TabKey;

type Props = {
  view: RailView;
  compareCount: number;
  onSelect: (view: RailView) => void;
};

/** Drawer nav in rail mode: Tabby is home; legacy panels live behind the
 * overflow menu until the parity checklist retires them (spec §Migration). */
export function RailNav({ view, compareCount, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function select(next: RailView) {
    setOpen(false);
    onSelect(next);
  }

  return (
    <nav className="mc-railnav" aria-label="Workspace sections">
      {view !== "tabby" ? (
        <button type="button" className="mc-railnav-back" aria-label="Back to Tabby" onClick={() => select("tabby")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
          Tabby
        </button>
      ) : null}
      <div className="mc-railnav-spacer" />
      <div
        className="mc-railnav-more"
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More panels"
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        {open ? (
          <div role="menu" className="mc-railnav-menu" aria-label="Panels">
            <button type="button" role="menuitem" onClick={() => select("compare")}>
              Compare{compareCount ? <span className="pill">{compareCount}</span> : null}
            </button>
            <button type="button" role="menuitem" onClick={() => select("export")}>
              Export
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}
