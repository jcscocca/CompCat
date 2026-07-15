import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("capacitor config", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the placeholder tailnet URL when MCA_IOS_SERVER_URL is unset", async () => {
    vi.stubEnv("MCA_IOS_SERVER_URL", "");
    const { default: config } = await import("./capacitor.config");
    expect(config.server?.url).toBe("https://compcat.example.ts.net");
    expect(config.appId).toBe("com.jscocca.compcat");
    expect(config.appName).toBe("CompCat");
    expect(config.webDir).toBe("../app/static/dashboard");
  });

  it("uses MCA_IOS_SERVER_URL when set", async () => {
    vi.stubEnv("MCA_IOS_SERVER_URL", "https://mybox.tail1234.ts.net");
    const { default: config } = await import("./capacitor.config");
    expect(config.server?.url).toBe("https://mybox.tail1234.ts.net");
  });
});
