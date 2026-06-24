import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  analyzePlaces,
  comparePlaces,
  createBulkPlaces,
  createPlace,
  createSession,
  deletePlace,
  getDashboardSummary,
} from "./api/client";
import type { DashboardSummary, Place } from "./types";

vi.mock("./api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn(),
  deletePlace: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

const libraryPlace: Place = {
  id: "p1",
  display_label: "Library",
  latitude: 47.621,
  longitude: -122.321,
  visit_count: 6,
  total_dwell_minutes: null,
  inferred_place_type: "manual_place",
  sensitivity_class: "normal",
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function makeSummary(places: Place[] = []): DashboardSummary {
  return {
  totals: {
    place_count: places.length,
    visit_count: places.reduce((sum, place) => sum + place.visit_count, 0),
    incident_count: 0,
  },
  privacy: {
    normal: 0,
    home_candidate: 0,
    work_candidate: 0,
    suppressed: 0,
  },
  places,
  crime_summaries: [],
  analysis: {
    available_radii_m: [],
  },
  exports: {
    tableau_place_summary_csv: "/exports/current.csv",
  },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders the dashboard shell copy", () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<App />);

    expect(screen.getByText("Seattle reported incident context")).toBeInTheDocument();
    expect(screen.getByText("Public incident context")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Compare places you visit" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/without uploading personal location history/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Important data note" }),
    ).toHaveTextContent("Reported incident context, not safety advice.");
    expect(
      screen.getByRole("region", { name: "Important data note" }),
    ).toHaveTextContent(
      "Reports can be incomplete, delayed, corrected, or geographically generalized.",
    );
    expect(
      screen.queryByRole("button", { name: "Export dashboard" }),
    ).not.toBeInTheDocument();
  });

  it("starts a session, fetches the summary, and renders returned places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([libraryPlace]));

    render(<App />);

    expect(await screen.findByText("Library")).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(getDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it("creates a manual place with typed payload and refreshes the summary", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValueOnce(makeSummary([libraryPlace]));
    vi.mocked(createPlace).mockResolvedValue(libraryPlace);

    render(<App />);

    await screen.findByText("No places entered yet.");
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: " Library " },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "47.621" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-122.321" },
    });
    fireEvent.change(screen.getByLabelText("Visits"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "Library",
        latitude: 47.621,
        longitude: -122.321,
        visit_count: 6,
        sensitivity_class: "normal",
      });
    });
    expect(await screen.findByText("Library")).toBeInTheDocument();
    expect(getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps manual creation success distinct from a refresh failure", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockRejectedValueOnce(new Error("refresh failed"));
    vi.mocked(createPlace).mockResolvedValue(libraryPlace);

    render(<App />);

    await screen.findByText("No places entered yet.");
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "Library" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "47.621" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-122.321" },
    });
    fireEvent.change(screen.getByLabelText("Visits"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add place/i }));

    expect(
      await screen.findByText("Saved, but dashboard totals could not refresh."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unable to add place. Try again.")).not.toBeInTheDocument();
  });

  it("imports bulk rows and refreshes the summary", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValueOnce(makeSummary([libraryPlace]));
    vi.mocked(createBulkPlaces).mockResolvedValue({
      created_count: 1,
      skipped_count: 0,
      places: [libraryPlace],
    });

    render(<App />);

    await screen.findByText("No places entered yet.");
    const csvText =
      "display_label,latitude,longitude,visit_count,total_dwell_minutes\nLibrary,47.621,-122.321,6,\n";
    fireEvent.change(screen.getByLabelText("CSV rows"), {
      target: { value: csvText },
    });
    fireEvent.click(screen.getByRole("button", { name: /import rows/i }));

    await waitFor(() => {
      expect(createBulkPlaces).toHaveBeenCalledWith(csvText);
    });
    expect(await screen.findByText("Library")).toBeInTheDocument();
    expect(getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it("deletes a place and refreshes the summary", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary([libraryPlace]))
      .mockResolvedValueOnce(makeSummary());
    vi.mocked(deletePlace).mockResolvedValue();

    render(<App />);

    expect(await screen.findByText("Library")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Library" }));

    await waitFor(() => {
      expect(deletePlace).toHaveBeenCalledWith("p1");
    });
    await waitFor(() => {
      expect(screen.queryByText("Library")).not.toBeInTheDocument();
    });
    expect(getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it("runs analysis for selected places and refreshes dashboard totals", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary([libraryPlace]))
      .mockResolvedValueOnce({
        ...makeSummary([libraryPlace]),
        totals: { place_count: 1, visit_count: 6, incident_count: 4 },
      });
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<App />);

    await screen.findByText("Library");
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Select Library"));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith({
        place_ids: ["p1"],
        analysis_start_date: "2024-01-01",
        analysis_end_date: "2024-01-31",
        radii_m: [250],
        offense_category: "PROPERTY",
      });
    });
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(getDashboardSummary).toHaveBeenCalledTimes(2);
  });

  it("compares selected places and exposes the summary export link", async () => {
    const cafePlace: Place = {
      ...libraryPlace,
      id: "p2",
      display_label: "Cafe",
      visit_count: 3,
    };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([libraryPlace, cafePlace]));
    vi.mocked(comparePlaces).mockResolvedValue({
      overview: {
        summary_text: "Library has a lower reported incident rate than Cafe.",
        caveat_text: "Reported incidents are contextual, not a personal risk prediction.",
      },
    });

    render(<App />);

    await screen.findByText("Library");
    expect(screen.getByRole("button", { name: /compare places/i })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Select Library"));
    fireEvent.click(screen.getByLabelText("Select Cafe"));
    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));

    await waitFor(() => {
      expect(comparePlaces).toHaveBeenCalledWith({
        place_ids: ["p1", "p2"],
        analysis_start_date: "2024-01-01",
        analysis_end_date: "2024-01-31",
        radius_m: 250,
        offense_category: "PROPERTY",
      });
    });
    expect(
      await screen.findByText("Library has a lower reported incident rate than Cafe."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download csv/i })).toHaveAttribute(
      "href",
      "/exports/current.csv",
    );
  });

  it("ignores a stale comparison response after selection changes", async () => {
    const cafePlace: Place = {
      ...libraryPlace,
      id: "p2",
      display_label: "Cafe",
      visit_count: 3,
    };
    const comparison = createDeferred<Record<string, unknown>>();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([libraryPlace, cafePlace]));
    vi.mocked(comparePlaces).mockReturnValue(comparison.promise);

    render(<App />);

    await screen.findByText("Library");
    fireEvent.click(screen.getByLabelText("Select Library"));
    fireEvent.click(screen.getByLabelText("Select Cafe"));
    fireEvent.click(screen.getByRole("button", { name: /compare places/i }));

    fireEvent.click(screen.getByLabelText("Select Cafe"));

    await act(async () => {
      comparison.resolve({
        overview: {
          summary_text: "This stale result should not render.",
          caveat_text: "Selection changed before the comparison resolved.",
        },
      });
      await comparison.promise;
    });

    expect(
      screen.queryByText("This stale result should not render."),
    ).not.toBeInTheDocument();
  });
});
