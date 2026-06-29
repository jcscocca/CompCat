// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataFreshness } from "./DataFreshness";
import type { DashboardFreshness } from "../types";

afterEach(cleanup);

const loaded: DashboardFreshness = {
  incident_count: 12345,
  data_through: "2026-06-22",
  earliest: "2008-01-01",
  last_ingested_at: "2026-06-23T04:00:00Z",
};

describe("DataFreshness", () => {
  it("shows a readable data-through date", () => {
    render(<DataFreshness freshness={loaded} />);
    expect(screen.getByText("Data through Jun 22, 2026")).toBeInTheDocument();
  });

  it("renders nothing before the data has loaded", () => {
    const { container } = render(<DataFreshness freshness={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no incident data is loaded", () => {
    render(
      <DataFreshness
        freshness={{ incident_count: 0, data_through: null, earliest: null, last_ingested_at: null }}
      />,
    );
    expect(screen.queryByText(/data through/i)).not.toBeInTheDocument();
  });
});
