// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClearPinsDialog } from "./ClearPinsDialog";

afterEach(cleanup);

describe("ClearPinsDialog", () => {
  it("describes saved and transient removal before confirming", () => {
    const onConfirm = vi.fn();
    render(
      <ClearPinsDialog
        savedPlaceCount={2}
        hasUnsavedPins
        busy={false}
        error=""
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Clear all pins?" })).toHaveTextContent(
      "This removes 2 saved places from this session and clears every unsaved pin.",
    );
    expect(screen.getByText(/previous result cards will remain/i)).toBeInTheDocument();
    expect(screen.getByText(/clears recent address searches from this tab/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all pins" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation open with a retryable error", () => {
    render(
      <ClearPinsDialog
        savedPlaceCount={1}
        hasUnsavedPins={false}
        busy={false}
        error="1 saved pin could not be removed. Try again."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("1 saved pin could not be removed");
  });
});
