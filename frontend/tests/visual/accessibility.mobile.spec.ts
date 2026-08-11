import { expect, test, type Page } from "@playwright/test";

import { expectNoAxeViolations } from "./accessibilitySupport";
import { mockEmptyDashboard, waitForStableDashboard } from "./mockDashboard";

async function openArea(page: Page, theme: "light" | "dark", tab: "Summary" | "Data" = "Summary") {
  await mockEmptyDashboard(page, theme);
  await waitForStableDashboard(page);
  await page.getByText("Select area", { exact: true }).click();
  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "Use visible map area" }).click();
  await page.getByRole("article", { name: "Area data" }).waitFor();
  if (tab === "Data") await page.getByRole("tab", { name: "Data" }).click();
}

for (const theme of ["light", "dark"] as const) {
  for (const snap of ["bar", "half", "full"] as const) {
    test(`mobile ${theme} ${snap} snap has no Axe violations`, async ({ page }) => {
      await mockEmptyDashboard(page, theme, snap);
      await waitForStableDashboard(page, snap !== "bar");
      const panel = page.getByRole("complementary", { name: "Tabby" });
      await expect(panel).toHaveClass(new RegExp(`is-${snap}`));
      if (snap === "full") {
        await expect(page.locator(".mc-map")).toHaveAttribute("inert", "");
        await expect(page.locator(".mc-map")).toHaveAttribute("aria-hidden", "true");
      }
      await expectNoAxeViolations(page, `mobile ${theme} ${snap} snap`);
    });
  }

  test(`mobile ${theme} area Summary has no Axe violations`, async ({ page }) => {
    await openArea(page, theme);
    await expectNoAxeViolations(page, `mobile ${theme} area Summary`);
  });

  test(`mobile ${theme} area Data has no Axe violations`, async ({ page }) => {
    await openArea(page, theme, "Data");
    await expectNoAxeViolations(page, `mobile ${theme} area Data`);
  });

  test(`mobile ${theme} area inspector reflows at 320px with WCAG text spacing`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openArea(page, theme);
    await page.addStyleTag({
      content: [
        "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }",
        "p { margin-bottom: 2em !important; }",
      ].join("\n"),
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const selectedTab = page.getByRole("tab", { selected: true });
    await selectedTab.focus();
    await expect(selectedTab).toBeFocused();
    await expectNoAxeViolations(page, `mobile ${theme} area inspector at 320px with text spacing`);
  });
}
