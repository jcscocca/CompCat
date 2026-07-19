// frontend/src/components/AssistantPanel.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel } from "./AssistantPanel";
import type { ThreadItem } from "../lib/threadItems";

type PanelProps = React.ComponentProps<typeof AssistantPanel>;

function setup(overrides: Partial<PanelProps> = {}) {
  const onSend = vi.fn();
  const onRetry = vi.fn();
  const onRunCommand = vi.fn();
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
    ...overrides,
  };
  render(<AssistantPanel {...props} />);
  return { onSend, onRetry, onRunCommand };
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("AssistantPanel", () => {
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
    expect(screen.getByText(/your filters and retry still work/i)).toBeInTheDocument();
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
});
