// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaceForm } from "./PlaceForm";

afterEach(cleanup);

describe("PlaceForm", () => {
  it("uses a default test location label when submitted without a name", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<PlaceForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "47.621" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.321" } });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      display_label: "Test location",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 1,
      sensitivity_class: "normal",
    });
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

  it("sends the chosen sensitivity class so the place can be hidden from exports", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<PlaceForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "47.621" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.321" } });
    fireEvent.change(screen.getByLabelText("Sensitivity"), { target: { value: "home_candidate" } });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivity_class: "home_candidate" }),
    );
  });
});
