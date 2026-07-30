// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BulkPlaceEntry } from "./BulkPlaceEntry";

describe("BulkPlaceEntry", () => {
  it("starts with a CSV template that does not ask for visit counts", () => {
    render(<BulkPlaceEntry onSubmit={vi.fn()} />);

    expect(screen.getByLabelText("Place rows (label, lat, lon)")).toHaveValue("display_label,latitude,longitude\n");
    expect(screen.getByLabelText("Place rows (label, lat, lon)")).not.toHaveValue(expect.stringContaining("visit_count"));
  });
});
