import { useEffect, useRef } from "react";

type Props = {
  savedPlaceCount: number;
  hasUnsavedPins: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
};

function removalCopy(savedPlaceCount: number, hasUnsavedPins: boolean): string {
  const savedCopy = savedPlaceCount === 1
    ? "This removes 1 saved place from this session"
    : `This removes ${savedPlaceCount} saved places from this session`;
  if (savedPlaceCount === 0) return "This clears every unsaved pin from the map.";
  return `${savedCopy}${hasUnsavedPins ? " and clears every unsaved pin" : ""}.`;
}

/** Shared destructive confirmation for the map shortcut and Manage Places action. */
export function ClearPinsDialog({
  savedPlaceCount,
  hasUnsavedPins,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="mc-modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-pins-title"
      aria-describedby="clear-pins-description clear-pins-history"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="mc-modal mc-clear-pins-modal" ref={dialogRef}>
        <div className="mc-clear-pins-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />
          </svg>
        </div>
        <h2 id="clear-pins-title">Clear all pins?</h2>
        <p id="clear-pins-description">{removalCopy(savedPlaceCount, hasUnsavedPins)}</p>
        <p id="clear-pins-history">This cannot be undone. Previous result cards will remain in your Tabby conversation.</p>
        {error ? <p className="mc-inline-error" role="alert">{error}</p> : null}
        <div className="mc-clear-pins-actions">
          <button type="button" className="mc-place-action" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="mc-place-action is-danger-solid" disabled={busy} onClick={onConfirm}>
            {busy ? "Clearing..." : "Clear all pins"}
          </button>
        </div>
      </div>
    </div>
  );
}
