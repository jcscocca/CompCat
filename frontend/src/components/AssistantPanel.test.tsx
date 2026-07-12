// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel } from "./AssistantPanel";
import type { AssistantDashboardState } from "../types";

const dashboardState: AssistantDashboardState = {
  selected_place_ids: ["p1", "p2"],
  analysis_start_date: "2024-01-01",
  analysis_end_date: "2024-01-31",
  radii_m: [250],
  offense_category: "PROPERTY",
  offense_subcategory: null,
  nibrs_group: null,
  layer: "reported",
};

function sseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("AssistantPanel", () => {
  it("posts chat history and dashboard state, then renders stream events", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        [
          'event: tool\ndata: {"tool_name":"compare_places","result":{"ok":true}}\n\n',
          'event: token\ndata: {"delta":"I found reported incident context."}\n\n',
          "event: done\ndata: {}\n\n",
        ].join(""),
      ),
    );

    render(<AssistantPanel dashboardState={dashboardState} />);

    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "Compare these places" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/assistant/chat",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: expect.any(String),
        }),
      );
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.dashboard_state).toEqual(dashboardState);
    expect(body.messages).toEqual([{ role: "user", content: "Compare these places" }]);
    expect(await screen.findByText("I found reported incident context.")).toBeInTheDocument();
    expect(screen.getByText(/compare_places/)).toBeInTheDocument();
  });

  it("clears tool activity from a prior turn when a new turn starts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        sseResponse(
          'event: tool\ndata: {"tool_name":"compare_places","result":{}}\n\n' +
            'event: token\ndata: {"delta":"first answer"}\n\n' +
            "event: done\ndata: {}\n\n",
        ),
      )
      .mockResolvedValueOnce(
        sseResponse(
          'event: token\ndata: {"delta":"second answer"}\n\n' + "event: done\ndata: {}\n\n",
        ),
      );

    render(<AssistantPanel dashboardState={dashboardState} />);

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "Compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("first answer")).toBeInTheDocument();
    expect(screen.getByText(/compare_places/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("second answer")).toBeInTheDocument();
    expect(screen.queryByText(/compare_places/)).not.toBeInTheDocument();
  });

  it("shows the backend error message with a retry button", async () => {
    // The backend is responsible for sending user-safe messages on error events.
    // The panel renders whatever message the backend provides.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        sseResponse(
          'event: error\ndata: {"message":"Couldn\'t reach the analyst. Try again shortly."}\n\n',
        ),
      );

    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Couldn't reach the analyst. Try again shortly."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("renders the backend error message instead of a blanket offline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: error\ndata: {"message":"Name at least two places to compare."}\n\n',
      ),
    );
    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Name at least two places to compare.")).toBeInTheDocument();
    expect(screen.queryByText(/can't reach the case files/i)).not.toBeInTheDocument();
  });

  it("clears the error banner when a retry succeeds", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse('event: error\ndata: {"message":"boom"}\n\n'))
      .mockResolvedValueOnce(
        sseResponse('event: token\ndata: {"delta":"ok"}\n\nevent: done\ndata: {}\n\n'),
      );
    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("ok");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the offline copy on a transport failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/can't reach the case files/i)).toBeInTheDocument();
  });

  it("forwards tool result data to onToolResult", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: tool\ndata: {"tool_name":"compare_places","result":{"place_ids":["a","b"]}}\n\n' +
          'event: token\ndata: {"delta":"done"}\n\n' +
          "event: done\ndata: {}\n\n",
      ),
    );
    const onToolResult = vi.fn();
    render(<AssistantPanel dashboardState={dashboardState} onToolResult={onToolResult} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("done");
    expect(onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ tool_name: "compare_places", result: { place_ids: ["a", "b"] } }),
    );
  });

  it("renders markdown in committed assistant messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: token\ndata: {"delta":"**bold** answer"}\n\n' + "event: done\ndata: {}\n\n",
      ),
    );

    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const bold = await screen.findByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("shows the explainer and quick actions when empty, and a chip sends its prompt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse("event: done\ndata: {}\n\n"),
    );
    render(<AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />);
    expect(
      screen.getByText("Copper, case desk. Point me at a place and I'll pull the reports near it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's on file around here?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What's near this pin?" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "What's near this pin?" });
    expect(body.dashboard_state).toEqual(dashboardState);
  });

  it("collapses to the header only", () => {
    render(<AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />);
    const collapse = screen.getByRole("button", { name: /collapse analyst/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(screen.queryByLabelText("Analyst message")).toBeNull();
    expect(screen.getByRole("button", { name: /expand analyst/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows Copper's header with the idle status and avatar mark", () => {
    const { container } = render(
      <AssistantPanel dashboardState={dashboardState} onToolResult={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: /copper/i })).toBeInTheDocument();
    expect(screen.getByText("At the desk")).toBeInTheDocument();
    expect(container.querySelector('svg[data-variant="mark"]')).not.toBeNull();
    expect(container.querySelector('svg[data-variant="bust"]')).not.toBeNull();
  });

  it("pulses the avatar until the first message is sent, then sets the greeted flag", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse("event: done\ndata: {}\n\n"));
    const { container } = render(<AssistantPanel dashboardState={dashboardState} />);
    expect(container.querySelector("svg.mc-copper-pulse")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(container.querySelector("svg.mc-copper-pulse")).toBeNull());
    expect(localStorage.getItem("wp-copper-greeted")).toBe("1");
  });

  it("does not pulse when previously greeted", () => {
    localStorage.setItem("wp-copper-greeted", "1");
    const { container } = render(<AssistantPanel dashboardState={dashboardState} />);
    expect(container.querySelector("svg.mc-copper-pulse")).toBeNull();
  });

  it("shows status labels transiently and clears them on the first token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: status\ndata: {"label":"interpreting your request…"}\n\n' +
          'event: status\ndata: {"label":"writing up…"}\n\n' +
          'event: token\ndata: {"delta":"Two places on file."}\n\n' +
          "event: done\ndata: {}\n\n",
      ),
    );

    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Two places on file.")).toBeInTheDocument();
    expect(screen.queryByText("interpreting your request…")).not.toBeInTheDocument();
    expect(screen.queryByText("writing up…")).not.toBeInTheDocument();
  });

  it("replace resets the draft and commits the replacement text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: token\ndata: {"delta":"partial answer that gets "}\n\n' +
          'event: replace\ndata: {"text":"Final replacement answer."}\n\n' +
          "event: done\ndata: {}\n\n",
      ),
    );

    render(<AssistantPanel dashboardState={dashboardState} />);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Final replacement answer.")).toBeInTheDocument();
    expect(screen.queryByText(/partial answer that gets/)).not.toBeInTheDocument();
  });
});

