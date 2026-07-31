// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PinDraftPopover } from "./PinDraftPopover";
import type { DraftPin } from "../types";

const draft: DraftPin = { latitude: 47.6097, longitude: -122.3331, display_label: "", visit_count: 1, sensitivity_class: "normal", source: "map" };

afterEach(cleanup);

describe("PinDraftPopover", () => {
  it("makes the naming step explicit and can focus the desktop field", () => {
    render(<PinDraftPopover draft={draft} saving={false} autoFocus onChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("form", { name: "Name this pin" })).toBeInTheDocument();
    expect(screen.getByText(/dropped on the map/i)).toHaveTextContent("47.6097, -122.3331");
    expect(screen.getByText(/rename this place later/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pin label/i)).toHaveFocus();
  });

  it("lets blank-label pins save and still emits optional label changes", () => {
    const onChange = vi.fn();
    render(<PinDraftPopover draft={draft} saving={false} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText(/visits per week/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save pin/i })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/pin label/i), { target: { value: "Home" } });
    expect(onChange).toHaveBeenCalledWith({ display_label: "Home" });
  });

  it("saves and cancels through their callbacks", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <PinDraftPopover draft={{ ...draft, display_label: "Home" }} saving={false} onChange={vi.fn()} onSave={onSave} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));
    expect(onSave).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
