// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AboutModal } from "./AboutModal";

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

  it("spells out what is stored, including the 24-hour session and 110 m share links", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/anonymous session cookie that lasts about 24 hours/i)).toBeInTheDocument();
    expect(screen.getByText(/expire with it/i)).toBeInTheDocument();
    expect(screen.getByText(/about 110 m/)).toBeInTheDocument();
    expect(screen.getByText(/No third-party requests/i)).toBeInTheDocument();
    expect(screen.getByText(/uploads are disabled on this instance/i)).toBeInTheDocument();
  });

  it("states the honest limits and links the MIT license", () => {
    render(<AboutModal onClose={vi.fn()} />);
    expect(screen.getByText(/incomplete, delayed, corrected, or geographically generalized/)).toBeInTheDocument();
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
