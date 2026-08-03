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

  it("uses three distinct evenly spaced integer y-axis ticks for sparse counts", () => {
    const sparse = MONTHS.map((_, index) => (index === 4 ? 1 : 0));
    const { container } = render(
      <TrendChart months={MONTHS} area={sparse} rolling={MONTHS.map(() => null)} citywide={null} />,
    );
    expect(
      [...container.querySelectorAll(".mc-trend-y-tick")].map((tick) => tick.textContent),
    ).toEqual(["0", "1", "2"]);
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

  it("directs exact-value inspection to the report export instead of an inline table", () => {
    render(<TrendChart months={MONTHS} area={AREA} rolling={ROLLING} citywide={CITY} />);
    expect(screen.queryByText("View monthly data")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/Exact values are available from the report Export menu/);
  });
});
