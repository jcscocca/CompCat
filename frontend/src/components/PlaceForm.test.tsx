// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceForm } from "./PlaceForm";

afterEach(cleanup);

describe("PlaceForm", () => {
  it("labels an unnamed place with its coordinates", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<PlaceForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "47.621" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.321" } });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      display_label: "Pin at 47.621, -122.321",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 1,
      sensitivity_class: "normal",
    });
  });

  it("prompts for an optional name rather than suggesting a test label", () => {
    render(<PlaceForm onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/label/i)).toHaveAttribute("placeholder", "Name this place (optional)");
  });

  it("does not ask users for visits and submits the default visit count", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<PlaceForm onSubmit={onSubmit} />);

    expect(screen.queryByLabelText(/visits per week/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Library" } });
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "47.621" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.321" } });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      display_label: "Library",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 1,
      sensitivity_class: "normal",
    });
  });

  it("has no sensitivity control and always submits a normal place (export exclusion moved to Export)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<PlaceForm onSubmit={onSubmit} />);

    expect(screen.queryByLabelText(/sensitivity/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "47.621" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.321" } });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivity_class: "normal" }),
    );
  });
});
