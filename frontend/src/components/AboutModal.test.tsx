// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AboutModal, ABOUT_DATA_CAVEAT, ABOUT_INVARIANT, ABOUT_RELIANCE_LIMIT } from "./AboutModal";

// jsdom implements no layout, so every element reports offsetParent === null and the dialog's
// visibility filter (shared verbatim with ManagePlacesModal) would find nothing focusable.
// Treat attached elements as visible here; real browsers supply the real value.
const offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});
afterAll(() => {
  if (offsetParentDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDescriptor);
  }
});

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

describe("AboutModal", () => {
  it("renders a labelled modal dialog with four concise sections", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "About CompCat" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const heading of [
      "What CompCat shows",
      "Data and freshness",
      "Privacy",
      "Limits",
    ]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole("heading", { level: 3 })).toHaveLength(4);
    expect((dialog.textContent ?? "").trim().split(/\s+/).length).toBeLessThan(225);
  });

  it("states the product invariant verbatim and credits the operator", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(
      screen.getByText(/does not score safety, rank places as safe, unsafe, or dangerous/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Built by Jacob Scocca/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat",
    );
    expect(screen.getByRole("link", { name: "MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat/blob/main/LICENSE",
    );
  });

  it("names and links the data sources and explains their daily-but-lagged freshness", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: "SPD Crime Data" })).toHaveAttribute(
      "href",
      "https://data.seattle.gov/Public-Safety/SPD-Crime-Data-2008-Present/tazs-3rd5",
    );
    expect(screen.getByRole("link", { name: "SPD Arrest Data" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call Data" })).toBeInTheDocument();
    expect(screen.getByText(/For full definitions and metadata/i)).toHaveTextContent(
      /refer to the linked dataset pages/i,
    );
    expect(screen.getByText(/Seattle refreshes these datasets daily/i)).toBeInTheDocument();
    expect(screen.getByText(/“Data through” is the newest event date loaded here/i)).toBeInTheDocument();
    expect(screen.getByText(/Updates are not live/i)).toHaveTextContent(
      /CAD calls can lag by a few days.*crime reports appear after approval/i,
    );
  });

  it("summarizes the essential privacy disclosures in one paragraph", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const privacy = screen.getByRole("heading", { name: "Privacy" }).nextElementSibling;
    expect(privacy?.tagName).toBe("P");
    expect(privacy).toHaveTextContent(/no user accounts/i);
    expect(privacy).toHaveTextContent(/session data.*cached address searches.*about 30 days/i);
    expect(privacy).toHaveTextContent(/Share links include the places and filters/i);
    expect(privacy).toHaveTextContent(/Address searches use OpenStreetMap/i);
    expect(privacy).toHaveTextContent(/Analyst sends analysis context.*language-model provider/i);
    expect(privacy).toHaveTextContent(/uploads are disabled on this instance/i);
  });

  it("states the essential data, storage, and reliance limits", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/incomplete, delayed, corrected, or geographically generalized/)).toBeInTheDocument();
    expect(screen.getByText(/database is not encrypted at rest/i)).toBeInTheDocument();
    expect(screen.getByText(/Don't rely on CompCat for safety or legal decisions/i)).toBeInTheDocument();
  });

  it("moves focus into the dialog on open and restores it on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { unmount } = render(<AboutModal onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes on Escape, on the close button, and on a scrim click but not a body click", () => {
    const onClose = vi.fn();
    const { container } = render(<AboutModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(container.querySelector(".mc-modal")!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(container.querySelector(".mc-modal-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("traps Tab between the first and last focusable controls", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    const items = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    const first = items[0];
    const last = items[items.length - 1];
    expect(items.length).toBeGreaterThan(1);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

// The standing invariant sweep (mirrors CompareVerdict / PlaceContextCard / CompareRankedList).
// About is the one surface that STATES the invariant, so the fixed caveat constants are
// removed first — exactly as the other sweeps stay clean by scoping around REVISED_CAVEAT.
const BANNED = ["safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"];
const FIXED_CAVEATS = [ABOUT_INVARIANT, ABOUT_RELIANCE_LIMIT, ABOUT_DATA_CAVEAT];

describe("AboutModal personal uploads line", () => {
  it("says uploads are disabled when the instance has them off", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/uploads are disabled on this instance/i)).toBeInTheDocument();
  });

  // The line was hard-coded, so an instance with uploads switched on told users the
  // opposite of the truth.
  it("describes uploads as opt-in and deletable when the instance has them on", () => {
    render(<AboutModal onClose={vi.fn()} personalUploadsEnabled />);
    expect(screen.queryByText(/uploads are disabled on this instance/i)).not.toBeInTheDocument();
    const line = screen.getByText(/Personal location-history uploads are opt-in/i);
    expect(line).toHaveTextContent(/can be deleted at any time/i);
  });
});

describe("AboutModal invariant sweep", () => {
  // Both branches of the runtime uploads line are swept: new copy on either side of that
  // conditional is still copy the invariant applies to.
  it.each([[false], [true]])("confines safety/risk vocabulary to the three fixed caveat constants (uploads enabled: %s)", (uploadsEnabled) => {
    const { container } = render(<AboutModal onClose={vi.fn()} personalUploadsEnabled={uploadsEnabled} />);
    const rendered = (container.textContent ?? "").toLowerCase();

    let remaining = rendered;
    for (const caveat of FIXED_CAVEATS) {
      const lowered = caveat.toLowerCase();
      expect(remaining).toContain(lowered); // the caveat must actually be on screen
      remaining = remaining.split(lowered).join(" ");
    }

    for (const banned of BANNED) {
      expect(remaining).not.toContain(banned);
    }
  });

  it("keeps the fixed caveats stating — never scoring — the invariant", () => {
    expect(ABOUT_INVARIANT).toMatch(/does not score safety/);
    expect(ABOUT_INVARIANT).toMatch(/rank places as safe, unsafe, or dangerous/);
    expect(ABOUT_INVARIANT).toMatch(/claim that anyone was present at an incident/);
    expect(ABOUT_RELIANCE_LIMIT).toMatch(/Don't rely on CompCat for safety or legal decisions/);
    // The only "risk" occurrence in the panel is the shipped per-card caveat.
    expect(ABOUT_DATA_CAVEAT).toMatch(/not a personal risk prediction/);
    expect(FIXED_CAVEATS.filter((text) => /risk/i.test(text))).toEqual([ABOUT_DATA_CAVEAT]);
  });
});
