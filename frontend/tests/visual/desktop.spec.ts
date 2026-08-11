import { expect, test } from "@playwright/test";

import { mockEmptyDashboard, waitForStableDashboard } from "./mockDashboard";

test("desktop map workspace preserves its clean onboarding composition", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await waitForStableDashboard(page);

  await expect(page.getByRole("main", { name: "Map and reported incident context" })).toHaveCount(1);
  await expect(page.getByRole("complementary", { name: "Tabby" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search an address" })).toBeVisible();
  await expect(page.getByText("Public session - Seattle")).toBeVisible();

  await expect(page).toHaveScreenshot("desktop-onboarding.png");
});

test("desktop About dialog stays visually integrated with the shell", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await waitForStableDashboard(page);

  await page.getByRole("button", { name: "About CompCat" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveScreenshot("desktop-about-dialog.png");
});

test("desktop area selection preserves the linked inspector layout", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await waitForStableDashboard(page);

  await page.getByText("Select area", { exact: true }).click();
  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "Use visible map area" }).click();
  const inspector = page.getByRole("article", { name: "Area data" });
  await expect(inspector.getByRole("heading", { name: "Area data" })).toBeVisible();
  await expect(inspector.getByText("Jan 1, 2025 — Oct 31, 2025")).toBeVisible();
  await expect(inspector.getByText("reported incidents across 11 mapped block locations")).toBeVisible();
  await expect(inspector.getByText("Scroll for all 24 hours →")).toBeVisible();

  await expect(page).toHaveScreenshot("desktop-area-inspector.png");
});
