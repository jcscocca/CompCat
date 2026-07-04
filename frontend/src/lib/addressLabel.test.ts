// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatIncidentAddress } from "./addressLabel";

describe("formatIncidentAddress", () => {
  it("collapses the same intersection regardless of cross-street order", () => {
    const a = formatIncidentAddress("PIKE ST / 3RD AVE");
    const b = formatIncidentAddress("3RD AVE / PIKE ST");
    expect(a).toBe(b);
    expect(a).toBe("3rd Ave & Pike St");
  });

  it("preserves directional prefixes and suffixes while collapsing order", () => {
    const a = formatIncidentAddress("S JACKSON ST / 12TH AVE S");
    const b = formatIncidentAddress("12TH AVE S / S JACKSON ST");
    expect(a).toBe(b);
    expect(a).toBe("12th Ave S & S Jackson St");
  });

  it("humanizes an anonymized block-face (XX -> 00)", () => {
    expect(formatIncidentAddress("14XX BLOCK OF 2ND AVE")).toBe("1400 block of 2nd Ave");
  });

  it("humanizes a plain block-face without XX or 'OF'", () => {
    expect(formatIncidentAddress("100 BLOCK MAIN ST")).toBe("100 block of Main St");
  });

  it("renders the redaction sentinel as withheld, not the raw token", () => {
    expect(formatIncidentAddress("REDACTED")).toBe("Address withheld");
  });

  it("treats blank/placeholder/unknown sentinels as unavailable", () => {
    expect(formatIncidentAddress(null)).toBe("Unavailable");
    expect(formatIncidentAddress("-")).toBe("Unavailable");
    expect(formatIncidentAddress("UNKNOWN")).toBe("Unavailable");
    expect(formatIncidentAddress("")).toBe("Unavailable");
  });

  it("title-cases a full street address it does not otherwise recognize", () => {
    expect(formatIncidentAddress("12018 NORTH PARK AVE N")).toBe("12018 North Park Ave N");
    expect(formatIncidentAddress("SEATTLE AREA")).toBe("Seattle Area");
  });
});
