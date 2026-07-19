// frontend/src/components/AssistantPanel.test.tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({ streamAssistantChat: vi.fn() }));

import { AssistantPanel } from "./AssistantPanel";
import { streamAssistantChat } from "../api/client";
import type { ThreadItem } from "../lib/threadItems";
import type { AssistantDashboardState } from "../types";

const dashboardState: AssistantDashboardState = {
  selected_place_ids: [],
  analysis_start_date: null,
  analysis_end_date: null,
  radii_m: [250],
  offense_category: null,
  offense_subcategory: null,
  nibrs_group: null,
  layer: "reported",
};

/** Harness owning thread + busy state the way MapWorkspace does. `withToggle` adds a
 * button that unmounts/remounts the panel, mirroring a mid-stream railView switch. */
function Harness({ initial = [] as ThreadItem[], withToggle = false }) {
  const [items, setItems] = useState<ThreadItem[]>(initial);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <>
      {withToggle ? (
        <button type="button" onClick={() => setHidden((h) => !h)}>Toggle panel</button>
      ) : null}
      {hidden ? null : (
        <AssistantPanel
          dashboardState={dashboardState}
          items={items}
          onAppend={(item) => setItems((current) => [...current, item])}
          busy={busy}
          onBusyChange={setBusy}
          contextStrip={<div data-testid="ctx-slot" />}
        />
      )}
    </>
  );
}

beforeEach(() => {
  vi.mocked(streamAssistantChat).mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe("AssistantPanel", () => {
  it("renders items by kind, including receipts and notices", () => {
    render(
      <Harness
        initial={[
          { kind: "user_text", text: "hello" },
          { kind: "tabby_text", text: "Hi there." },
          { kind: "receipt", text: "Search radius → 500 m" },
          { kind: "notice", text: "Something went sideways." },
        ]}
      />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Hi there.")).toBeInTheDocument();
    const receipt = screen.getByText("Search radius → 500 m");
    expect(receipt.closest(".mc-dock-msg")).toHaveClass("is-receipt");
    expect(screen.getByText("Something went sideways.").closest(".mc-dock-msg")).toHaveClass("is-notice");
    expect(screen.getByTestId("ctx-slot")).toBeInTheDocument();
  });

  it("appends the user turn and Tabby's reply on a successful stream", async () => {
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "On it." } });
      onEvent({ event: "done", data: {} });
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Home" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("analyze Home")).toBeInTheDocument();
    expect(await screen.findByText("On it.")).toBeInTheDocument();
    const call = vi.mocked(streamAssistantChat).mock.calls[0][0];
    expect(call.messages).toEqual([{ role: "user", content: "analyze Home" }]);
  });

  it("appends a notice with Retry on stream error, and Retry re-sends the same turn", async () => {
    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "error", data: { message: "LLM unreachable" } });
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("LLM unreachable")).toBeInTheDocument();

    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "Back now." } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Back now.")).toBeInTheDocument();
    // Retry must not duplicate the user turn.
    const retryCall = vi.mocked(streamAssistantChat).mock.calls[1][0];
    expect(retryCall.messages).toEqual([{ role: "user", content: "hi" }]);
    await waitFor(() => expect(screen.getAllByText("hi")).toHaveLength(1));
  });

  it("keeps Retry on a notice that is only followed by receipts", () => {
    render(
      <Harness
        initial={[
          { kind: "user_text", text: "hi" },
          { kind: "notice", text: "LLM unreachable" },
          { kind: "receipt", text: "Search radius → 500 m" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the streaming draft mid-stream and settles to a single committed node", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "Working…" } });
      await gate;
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Working…")).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getAllByText("Working…")).toHaveLength(1));
    await waitFor(() => expect(screen.getByText("At the desk")).toBeInTheDocument());
    expect(screen.getAllByText("Working…")).toHaveLength(1);
  });

  it("keeps the composer locked across unmount/remount while a turn is in flight", async () => {
    // Bridge effects flip the drawer to a legacy view mid-stream, unmounting the panel.
    // The busy flag lives in the parent so the remounted panel cannot start a second
    // concurrent stream while the first turn is still in flight.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(streamAssistantChat).mockImplementationOnce(async (_payload, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "Working…" } });
      await gate;
    });
    render(<Harness withToggle />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Working…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));
    expect(screen.queryByLabelText("Analyst message")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle panel" }));

    // Remounted mid-stream: still locked, still reporting the in-flight turn.
    expect(screen.getByText("Checking the files…")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "again" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    release();
    await waitFor(() => expect(screen.getByText("At the desk")).toBeInTheDocument());
    expect(streamAssistantChat).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state with suggested prompts and no collapse control", () => {
    render(<Harness />);
    expect(screen.getByText(/point me at a place/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare my places" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse analyst/i })).not.toBeInTheDocument();
  });
});
