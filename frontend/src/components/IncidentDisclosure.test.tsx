// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IncidentDisclosure } from "./IncidentDisclosure";

afterEach(cleanup);

describe("IncidentDisclosure", () => {
  it("renders nothing before the first fetch", () => {
    render(<IncidentDisclosure returnedCount={0} totalCount={0} unmappableCitywideCount={0} limit={0} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows shown + citywide redacted counts", () => {
    render(<IncidentDisclosure returnedCount={42} totalCount={42} unmappableCitywideCount={6} limit={5000} />);
    const chip = screen.getByRole("status");
    expect(chip).toHaveTextContent("42 incidents shown");
    expect(chip).toHaveTextContent("+6 citywide with redacted location — in beat stats only");
  });

  it("discloses truncation when the cap bites", () => {
    render(<IncidentDisclosure returnedCount={5000} totalCount={12340} unmappableCitywideCount={0} limit={5000} />);
    expect(screen.getByRole("status")).toHaveTextContent("most recent 5,000 of 12,340 shown");
  });

  it("omits the redaction clause when nothing was redacted", () => {
    render(<IncidentDisclosure returnedCount={10} totalCount={10} unmappableCitywideCount={0} limit={5000} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("redacted");
  });
});
