// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CopperAvatar } from "./CopperAvatar";

afterEach(cleanup);

describe("CopperAvatar", () => {
  it("renders the decorative mark at the requested size", () => {
    const { container } = render(<CopperAvatar variant="mark" size={20} />);
    const svg = container.querySelector('svg[data-variant="mark"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("height", "20");
  });

  it("renders the bust variant and forwards className", () => {
    const { container } = render(
      <CopperAvatar variant="bust" size={72} className="mc-copper-pulse" />,
    );
    const svg = container.querySelector('svg[data-variant="bust"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("mc-copper-pulse");
    expect(svg).toHaveAttribute("width", "72");
  });
});
