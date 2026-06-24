import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlaceForm } from "./PlaceForm";

describe("PlaceForm", () => {
  it("shows a label validation error when submitted empty", async () => {
    const onSubmit = vi.fn();

    render(<PlaceForm onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(screen.getByText("Enter a place label.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
