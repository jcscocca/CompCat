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
});

