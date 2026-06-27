// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalUpload } from "./PersonalUpload";

afterEach(cleanup);

describe("PersonalUpload", () => {
  it("shows the caveat and enables upload only after consent + a file", () => {
    render(<PersonalUpload onUploaded={vi.fn()} />);
    expect(screen.getByText(/never claims you were present/i)).toBeInTheDocument();

    const button = screen.getByRole("button", { name: /^upload$/i });
    expect(button).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I understand/i));
    expect(button).toBeDisabled(); // a file is still required

    const file = new File(["{}"], "timeline.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText(/location history file/i), {
      target: { files: [file] },
    });
    expect(button).not.toBeDisabled();
  });
});
