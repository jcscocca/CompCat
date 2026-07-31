// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrendChart } from "./TrendChart";

function months60(): string[] {
  const out: string[] = [];
  let y = 2021;
  let m = 7;
  for (let i = 0; i < 60; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MONTHS = months60();
const AREA = MONTHS.map((_, i) => 10 + (i % 6));
const ROLLING = MONTHS.map((_, i) => (i < 11 ? null : 12));
const CITY = MONTHS.map((_, i) => 11 + (i % 5));

afterEach(cleanup);

describe("TrendChart", () => {
  it("renders the chart and three series paths when citywide is provided", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={CITY} />);
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getByTestId("trend-raw")).toBeInTheDocument();
    expect(screen.getByTestId("trend-rolling")).toBeInTheDocument();
    expect(screen.getByTestId("trend-city")).toBeInTheDocument();
  });

  it("omits the citywide path when citywide is null", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={null} />);
    expect(screen.queryByTestId("trend-city")).not.toBeInTheDocument();
    expect(screen.getByTestId("trend-raw")).toBeInTheDocument();
  });

  it("labels January ticks with the year", () => {
    const { container } = render(
      <TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={CITY} />,
    );
    expect(container.textContent).toContain("2022");
    expect(container.textContent).toContain("2023");
  });

  it("shows a rounded readout row on hover", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={CITY} />);
    const svg = screen.getByTestId("trend-chart");
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 560, bottom: 170, width: 560, height: 170, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 560 });
    const readout = screen.getByTestId("trend-readout");
    expect(readout).toBeInTheDocument();
    expect(readout.textContent).toMatch(/2026-06/);
    // rounded integer values only (no decimals)
    expect(readout.textContent).not.toMatch(/\d\.\d/);
    fireEvent.pointerLeave(svg);
    expect(screen.queryByTestId("trend-readout")).not.toBeInTheDocument();
  });

  it("provides every plotted value in a keyboard-operable data table", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={CITY} />);
    const disclosure = screen.getByText("View monthly data");
    fireEvent.click(disclosure);

    const table = screen.getByRole("table", { name: "Monthly trend values" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Monthly count" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "12-month average" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Citywide indexed" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "2021-07 10 — 11" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "2022-06 15 12 12" })).toBeInTheDocument();
  });

  it("omits the citywide column from the data table when that series is suppressed", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={null} />);
    fireEvent.click(screen.getByText("View monthly data"));
    expect(screen.queryByRole("columnheader", { name: "Citywide indexed" })).not.toBeInTheDocument();
  });
});
