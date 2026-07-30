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
  it("renders a labelled modal dialog with every section", () => {
    render(<AboutModal onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "About CompCat" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const heading of [
      "What this is",
      "Scope",
      "Data sources",
      "What's stored",
      "Honest limits",
      "License",
    ]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
  });

  it("states the product invariant verbatim and credits the operator", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(
      screen.getByText(/does not score safety, rank places as safe, unsafe, or dangerous/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Built by Jacob Scocca/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat",
    );
  });

  it("names the data sources, the basemap attribution, and the freshness pill", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/Seattle Police Department \(SPD\) datasets/)).toBeInTheDocument();
    expect(screen.getByText(/City of Seattle open data portal/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument();
    expect(screen.getByText(/Protomaps/)).toBeInTheDocument();
    expect(screen.getByText(/“Data through”/)).toBeInTheDocument();
  });

  it("spells out sliding anonymous sessions, retention, geocode caching, and share links", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/renewed while you use the app/i)).toBeInTheDocument();
    expect(screen.getByText(/absolute session limit.*about 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/new anonymous session starts/i)).toHaveTextContent(
      /saved places from the earlier session are no longer linked in this browser/i,
    );
    expect(screen.getByText(/quiet.*automatically deleted.*about 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/no account, name, email, or personal identity/i)).toBeInTheDocument();
    expect(screen.getByText(/about 110 m/)).toBeInTheDocument();
    expect(screen.getByText(/normalized address you typed and the returned coordinates/i)).toBeInTheDocument();
    expect(screen.getByText(/cache is shared across visitors.*about 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/uploads are disabled on this instance/i)).toBeInTheDocument();
  });

  it("distinguishes browser-local assets from the server's address and Analyst providers", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/Your browser does not contact third parties/i)).toHaveTextContent(
      /map tiles, fonts, and address-search requests load from this server/i,
    );
    expect(screen.getByText(/server sends address lookups/i)).toHaveTextContent(
      /OpenStreetMap's Nominatim service/i,
    );
    expect(screen.getByText(/If you use the Analyst/i)).toHaveTextContent(
      /place names and coordinates.*configured LLM provider/i,
    );
    expect(screen.queryByText(/No third-party requests/i)).not.toBeInTheDocument();
  });

  it("states the statistical and data limits and links the MIT license", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/incomplete, delayed, corrected, or geographically generalized/)).toBeInTheDocument();
    expect(screen.getByText(/density per square kilometre per day/i)).toHaveTextContent(
      /not a per-person or per-visit rate/i,
    );
    expect(screen.getByText(/Results depend on the radius/i)).toBeInTheDocument();
    expect(screen.getByText(/within one analysis run/i)).toHaveTextContent(
      /not across the many filter, layer, or radius combinations/i,
    );
    expect(screen.getByText(/Intervals are approximate/i)).toHaveTextContent(
      /near, not exactly, 95%.*estimated from a small number of months/i,
    );
    expect(screen.getByText(/no accounts, no production authentication, and no encryption at rest/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/jcscocca/CompCat/blob/main/LICENSE",
    );
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
    expect(line).toHaveTextContent(/nothing is uploaded unless you choose to/i);
    expect(line).toHaveTextContent(/delete what you uploaded at any time/i);
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
