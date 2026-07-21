// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataFreshness } from "./DataFreshness";
import type { DashboardFreshness } from "../types";

afterEach(cleanup);

const empty = { incident_count: 0, data_through: null, earliest: null, last_ingested_at: null };
const loaded: DashboardFreshness = {
  reported: {
    incident_count: 12345,
    data_through: "2026-06-22",
    earliest: "2008-01-01",
    last_ingested_at: "2026-06-23T04:00:00Z",
  },
  arrests: {
    incident_count: 3210,
    data_through: "2026-06-20",
    earliest: "2008-01-01",
    last_ingested_at: "2026-06-23T04:00:00Z",
  },
  calls: {
    incident_count: 678,
    data_through: "2026-06-21",
    earliest: "2024-07-01",
    last_ingested_at: "2026-06-23T04:00:00Z",
  },
};

describe("DataFreshness", () => {
  it("shows the active layer's data-through date", () => {
    render(<DataFreshness freshness={loaded} layer="reported" />);
    expect(screen.getByText("Data through Jun 22, 2026")).toBeInTheDocument();
  });

  it("reflects the calls layer when selected", () => {
    render(<DataFreshness freshness={loaded} layer="calls" />);
    expect(screen.getByText("Data through Jun 21, 2026")).toBeInTheDocument();
    expect(screen.getByTitle(/911 calls/)).toBeInTheDocument();
  });

  it("renders nothing before the data has loaded", () => {
    const { container } = render(<DataFreshness freshness={null} layer="reported" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states when the active layer has no loaded data", () => {
    render(<DataFreshness freshness={{ reported: empty, arrests: empty, calls: empty }} layer="reported" loaded />);
    expect(screen.getByText("No reported SPD incidents data loaded")).toBeInTheDocument();
  });

  it("distinguishes an availability request failure from an empty layer", () => {
    render(<DataFreshness freshness={null} layer="reported" loaded />);
    expect(screen.getByText("Data availability unavailable")).toBeInTheDocument();
  });
});
