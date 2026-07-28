// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  uploadPersonalData: vi.fn(),
  deletePersonalData: vi.fn(),
}));

import { PersonalUpload } from "./PersonalUpload";
import { deletePersonalData, uploadPersonalData } from "../api/client";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

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

  it("shows a static fallback instead of the thrown error message", async () => {
    vi.mocked(uploadPersonalData).mockRejectedValue(new Error("500: {\"detail\":\"traceback…\"}"));
    render(<PersonalUpload onUploaded={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/I understand/i));
    fireEvent.change(screen.getByLabelText(/location history file/i), {
      target: { files: [new File(["{}"], "timeline.json", { type: "application/json" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Upload failed. Check the file and try again.");
    expect(status).not.toHaveTextContent(/traceback/);
  });

  it("shows a static fallback when the delete call fails", async () => {
    vi.mocked(deletePersonalData).mockRejectedValue(new Error("boom: raw body"));
    render(<PersonalUpload onUploaded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /delete my uploaded data/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Couldn't delete your uploaded data. Try again."),
    );
  });
});
