import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { AppErrorBoundary } from "./AppErrorBoundary";

const workspace = vi.hoisted(() => ({ fail: false }));
const privateDetails = "PRIVATE_LOCATION 47.6005,-122.3315 raw API body /private/source.ts:42";

vi.mock("./MapWorkspace", () => ({
  MapWorkspace: () => {
    if (workspace.fail) throw new Error(privateDetails);
    return <p>Workspace ready</p>;
  },
}));

afterEach(() => {
  cleanup();
  workspace.fail = false;
  vi.restoreAllMocks();
});

describe("App render recovery", () => {
  it("renders the workspace when healthy", () => {
    render(<App />);
    expect(screen.getByText("Workspace ready")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("catches a workspace render failure, focuses recovery, and hides private details", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    workspace.fail = true;
    const { container } = render(<App />);
    const heading = screen.getByRole("heading", { level: 1, name: "This page needs a fresh start" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("main", { name: heading.textContent! })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Reload the page");
    expect(screen.getByRole("button", { name: "Reload CompCat" })).toBeEnabled();
    for (const detail of privateDetails.split(" ")) expect(container.innerHTML).not.toContain(detail);
    expect(screen.queryByText("Workspace ready")).not.toBeInTheDocument();
  });

  it("keeps the fallback stable until a fresh mount", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => { throw new Error(privateDetails); };
    const { rerender, unmount } = render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    rerender(<AppErrorBoundary><p>Workspace ready</p></AppErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    unmount();
    render(<AppErrorBoundary><p>Workspace ready</p></AppErrorBoundary>);
    expect(screen.getByText("Workspace ready")).toBeInTheDocument();
  });
});
