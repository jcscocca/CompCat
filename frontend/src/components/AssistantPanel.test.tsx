// frontend/src/components/AssistantPanel.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel } from "./AssistantPanel";
import type { FollowupChip } from "../lib/followupChips";
import type { ThreadItem } from "../lib/threadItems";
import type { AnalysisCardData } from "../types";

type PanelProps = React.ComponentProps<typeof AssistantPanel>;

const analyzeCard: AnalysisCardData = {
  runId: "run-7",
  kind: "analyze",
  placeIds: ["p1"],
  settings: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-07-19", offense_category: null, layer: "reported" },
  comparison: null,
  neighborhood: null,
  incidents: null,
};

const widenChip: FollowupChip = {
  label: "Widen to 500 m",
  command: "analyze_places",
  argsPatch: { radii_m: [500] },
  settingsPatch: { radius_m: 500 },
};

function setup(overrides: Partial<PanelProps> = {}) {
  const onSend = vi.fn();
  const onRetry = vi.fn();
  const onRunCommand = vi.fn();
  const onFollowupChip = vi.fn();
  const onCardExpandChange = vi.fn();
  const onAction = vi.fn();
  const props: PanelProps = {
    items: [],
    busy: false,
    draft: "",
    statusLine: "",
    toolActivity: [],
    offline: false,
    onSend,
    onRetry,
    onRunCommand,
    followupChips: [],
    onFollowupChip,
    expandedCard: null,
    onCardExpandChange,
    exportHrefBase: "/exports/tableau/place-summary.csv",
    hasPlaces: true,
    onAction,
    ...overrides,
  };
  const view = render(<AssistantPanel {...props} />);
  const rerender = (next: Partial<PanelProps>) => view.rerender(<AssistantPanel {...props} {...next} />);
  return { onSend, onRetry, onRunCommand, onFollowupChip, onCardExpandChange, onAction, rerender };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("AssistantPanel", () => {
  it("renders pane actions in the Tabby header", () => {
    setup({ paneActions: <button type="button">Collapse Tabby pane</button> });
    expect(screen.getByRole("button", { name: "Collapse Tabby pane" }).closest(".mc-dock-head")).toBeInTheDocument();
  });

  it("renders items by kind, including receipts and notices, plus the contextStrip slot", () => {
    setup({
      items: [
        { kind: "user_text", text: "hello" },
        { kind: "tabby_text", text: "Hi there." },
        { kind: "receipt", text: "Search radius → 500 m" },
        { kind: "notice", text: "Something went sideways." },
      ],
      contextStrip: <div data-testid="ctx-slot" />,
    });
    expect(screen.getByText("hello").closest(".mc-dock-msg")).toHaveClass("is-user");
    expect(screen.getByText("Hi there.").closest(".mc-dock-msg")).toHaveClass("is-assistant");
    expect(screen.getByText("Search radius → 500 m").closest(".mc-dock-msg")).toHaveClass("is-receipt");
    expect(screen.getByText("Something went sideways.").closest(".mc-dock-msg")).toHaveClass("is-notice");
    expect(screen.getByTestId("ctx-slot")).toBeInTheDocument();
  });

  it("submit calls onSend with trimmed text and clears the input", () => {
    const { onSend } = setup();
    const textarea = screen.getByLabelText("Analyst message");
    fireEvent.change(textarea, { target: { value: "  analyze Home  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("analyze Home");
    expect(textarea).toHaveValue("");
  });

  it("command chip runs a command; the prompt chip sends free text", () => {
    const { onSend, onRunCommand } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Compare my places" }));
    expect(onRunCommand).toHaveBeenCalledWith("Compare my places", "compare_places");
    fireEvent.click(screen.getByRole("button", { name: "What's on file around here?" }));
    expect(onSend).toHaveBeenCalledWith("What's on file around here?");
  });

  it("offline disables the composer and prompt chip but keeps command chips live", () => {
    const { onRunCommand } = setup({ offline: true });
    expect(screen.getByLabelText("Analyst message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "What's on file around here?" })).toBeDisabled();
    expect(screen.getByText(/chips and filters still work/i)).toBeInTheDocument();
    // Command chips stay enabled — the degraded path still runs structured commands.
    // (Offline + chips-on-screen only co-occurs today on an empty thread; the state
    // becomes generally reachable when persistent chips land in slice 3.)
    const compareChip = screen.getByRole("button", { name: "Compare my places" });
    expect(compareChip).not.toBeDisabled();
    fireEvent.click(compareChip);
    expect(onRunCommand).toHaveBeenCalledWith("Compare my places", "compare_places");
  });

  it("renders the draft prop as a single in-flight bubble alongside committed items", () => {
    setup({ items: [{ kind: "user_text", text: "go" }], draft: "Working…" });
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getAllByText("Working…")).toHaveLength(1);
  });

  it("renders an analysis_card item in the thread and forwards its expand toggle with the card object", () => {
    const { onCardExpandChange } = setup({
      items: [
        { kind: "user_text", text: "analyze Home" },
        { kind: "analysis_card", card: analyzeCard },
      ] as ThreadItem[],
    });
    expect(screen.getByText("Analysis result")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Location analysis" })).toBeInTheDocument();
    expect(screen.queryByText(/250 m/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(onCardExpandChange).toHaveBeenCalledWith(analyzeCard, true);
  });

  it("expands the card matching expandedCard by object identity", () => {
    setup({
      items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
      expandedCard: analyzeCard,
    });
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("keeps the SAME card expanded when a thread-cap drop shifts its index", () => {
    // The thread cap slices oldest items off the front, moving every survivor down an
    // index. Expansion is keyed by card object identity, so the card must stay expanded.
    const { rerender } = setup({
      items: [
        { kind: "user_text", text: "oldest — about to drop" },
        { kind: "analysis_card", card: analyzeCard },
      ] as ThreadItem[],
      expandedCard: analyzeCard,
    });
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    rerender({
      items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
    });
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View details" })).not.toBeInTheDocument();
  });

  it("renders the follow-up chip row when chips are present and forwards clicks", () => {
    const { onFollowupChip } = setup({ followupChips: [widenChip] });
    const chip = screen.getByRole("button", { name: "Widen to 500 m" });
    expect(chip.closest(".mc-followups")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(onFollowupChip).toHaveBeenCalledWith(widenChip);
  });

  it("hides the follow-up chip row while a turn is busy", () => {
    setup({ followupChips: [widenChip], busy: true });
    expect(screen.queryByRole("button", { name: "Widen to 500 m" })).not.toBeInTheDocument();
  });

  it("keeps follow-up chips live while offline (the degraded command path)", () => {
    const { onFollowupChip } = setup({ followupChips: [widenChip], offline: true });
    const chip = screen.getByRole("button", { name: "Widen to 500 m" });
    expect(chip).not.toBeDisabled();
    fireEvent.click(chip);
    expect(onFollowupChip).toHaveBeenCalledWith(widenChip);
  });

  it("folds the in-flight draft after a card item without index collision", () => {
    setup({
      items: [
        { kind: "user_text", text: "analyze Home" },
        { kind: "analysis_card", card: analyzeCard },
      ] as ThreadItem[],
      draft: "Working…",
    });
    expect(screen.getByText("Analysis result")).toBeInTheDocument();
    expect(screen.getAllByText("Working…")).toHaveLength(1);
  });

  describe("focusCard scroll-into-view", () => {
    it("scrolls the matching card into view when focusCard is set", () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      setup({
        items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
        focusCard: { card: analyzeCard },
      });
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    });

    it("does not scroll when focusCard is null", () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      setup({
        items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
        focusCard: null,
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("does not scroll when focusCard matches no rendered card", () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      const otherCard: AnalysisCardData = { ...analyzeCard, runId: "run-other" };
      setup({
        items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
        focusCard: { card: otherCard },
      });
      expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("re-fires on a repeat focus of the same card (fresh request object)", () => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      const { rerender } = setup({
        items: [{ kind: "analysis_card", card: analyzeCard }] as ThreadItem[],
        focusCard: { card: analyzeCard },
      });
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      // A second badge tap hands a NEW request object wrapping the SAME card; the fresh
      // identity must re-fire the scroll (the one-shot concern the plan calls out).
      rerender({ focusCard: { card: analyzeCard } });
      expect(scrollSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("onboarding empty state (hasPlaces=false)", () => {
    it("renders the fresh-session greeting and action chips, routing clicks to onAction", () => {
      const { onAction } = setup({ hasPlaces: false });
      expect(
        screen.getByText(
          "Tabby, case desk. Point me at a place — search an address, drop a pin, or add one by hand — and I'll pull the reports near it.",
        ),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Search an address" }));
      expect(onAction).toHaveBeenCalledWith("search");

      fireEvent.click(screen.getByRole("button", { name: "Drop a pin" }));
      expect(onAction).toHaveBeenCalledWith("add-pin");

      fireEvent.click(screen.getByRole("button", { name: "Add places manually" }));
      expect(onAction).toHaveBeenCalledWith("manual");
    });

    it("does not render the has-places SUGGESTED_ACTIONS chips", () => {
      setup({ hasPlaces: false });
      expect(screen.queryByRole("button", { name: "Compare my places" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "What's near this pin?" })).not.toBeInTheDocument();
    });

    it("disables action chips while busy but keeps them live while offline", () => {
      const { rerender } = setup({ hasPlaces: false, offline: true });
      expect(screen.getByRole("button", { name: "Search an address" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Drop a pin" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Add places manually" })).not.toBeDisabled();

      rerender({ hasPlaces: false, offline: true, busy: true });
      expect(screen.getByRole("button", { name: "Search an address" })).toBeDisabled();
    });
  });

  it("keeps the has-places greeting and SUGGESTED_ACTIONS chips when hasPlaces is true", () => {
    setup({ hasPlaces: true });
    expect(screen.getByText("Tabby, case desk. Point me at a place and I'll pull the reports near it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's near this pin?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare my places" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's on file around here?" })).toBeInTheDocument();
  });

  it("shows Retry on a notice followed only by receipts and calls onRetry", () => {
    const { onRetry } = setup({
      items: [
        { kind: "user_text", text: "hi" },
        { kind: "notice", text: "LLM unreachable" },
        { kind: "receipt", text: "Search radius → 500 m" },
      ] as ThreadItem[],
    });
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("announces a non-empty errorLine as an alert on the rail", () => {
    setup({ errorLine: "Unable to rename place. Try again." });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Unable to rename place. Try again.");
    expect(alert).toHaveClass("mc-inline-error");
  });

  it("renders no alert when errorLine is empty", () => {
    const { rerender } = setup({ errorLine: "" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender({ errorLine: undefined });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
