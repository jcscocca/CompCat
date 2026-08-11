import { expect, test } from "@playwright/test";

import { mockEmptyDashboard, waitForStableDashboard } from "./mockDashboard";

test("mobile dark theme preserves the map and half-sheet hierarchy", async ({ page }) => {
  await mockEmptyDashboard(page);
  await waitForStableDashboard(page);

  await expect(page.getByRole("complementary", { name: "Tabby" })).toHaveClass(/is-half/);
  await expect(page.getByRole("button", { name: "Map key" })).toBeVisible();
  await expect(page.getByRole("button", { name: "About CompCat" })).toBeVisible();

  await expect(page).toHaveScreenshot("mobile-dark-onboarding.png");
});
