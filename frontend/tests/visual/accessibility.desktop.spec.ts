import { expect, test, type Page } from "@playwright/test";

import { expectNoAxeViolations } from "./accessibilitySupport";
import { mockEmptyDashboard, waitForSharedReport, waitForStableDashboard } from "./mockDashboard";

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
  test(`desktop ${theme} onboarding has no Axe violations`, async ({ page }) => {
    await mockEmptyDashboard(page, theme);
    await waitForStableDashboard(page);
    await expectNoAxeViolations(page, `desktop ${theme} onboarding`);
  });

  test(`desktop ${theme} analyzed report has no Axe violations`, async ({ page }) => {
    await mockEmptyDashboard(page, theme);
    await waitForSharedReport(page);
    await expectNoAxeViolations(page, `desktop ${theme} analyzed report`);
  });

  test(`desktop ${theme} expanded report has no Axe violations`, async ({ page }) => {
    await mockEmptyDashboard(page, theme);
    await waitForSharedReport(page);
    await page.getByRole("button", { name: "View details" }).click();
    await expect(page.getByRole("button", { name: "Collapse", exact: true })).toBeVisible();
    await expectNoAxeViolations(page, `desktop ${theme} expanded report`);
  });

  test(`desktop ${theme} About dialog has no Axe violations`, async ({ page }) => {
    await mockEmptyDashboard(page, theme);
    await waitForStableDashboard(page);
    await page.getByRole("button", { name: "About CompCat" }).click();
    await expectNoAxeViolations(page, `desktop ${theme} About dialog`);
  });

  test(`desktop ${theme} Manage Places views have no Axe violations`, async ({ page }) => {
    await mockEmptyDashboard(page, theme);
    await waitForStableDashboard(page);
    await page.getByRole("button", { name: "Manage places" }).click();
    await expectNoAxeViolations(page, `desktop ${theme} Manage Places dialog`);
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await expectNoAxeViolations(page, `desktop ${theme} Manage Places ${await tab.textContent()} tab`);
    }
  });

  test(`desktop ${theme} area Summary has no Axe violations`, async ({ page }) => {
    await openArea(page, theme);
    const summary = page.getByRole("tab", { name: "Summary" });
    await summary.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Data" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(summary).toBeFocused();
    const exactValues = page.getByText("View exact values").first();
    await exactValues.focus();
    await page.keyboard.press("Enter");
    await expect(exactValues.locator("..").getByRole("table")).toBeVisible();
    for (const button of await page.getByRole("group", { name: /records by hour of day/i }).getByRole("button").all()) {
      expect((await button.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(24);
    }
    await expectNoAxeViolations(page, `desktop ${theme} area Summary`);
  });

  test(`desktop ${theme} area Data has no Axe violations`, async ({ page }) => {
    await openArea(page, theme, "Data");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Rows" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("region", { name: /area records table/i })).toBeFocused();
    await expectNoAxeViolations(page, `desktop ${theme} area Data`);
  });
}
