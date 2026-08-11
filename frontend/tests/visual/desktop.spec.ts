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

test("desktop area inspector keeps every output synchronized with linked filters", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await waitForStableDashboard(page);

  await page.getByText("Select area", { exact: true }).click();
  await page.getByRole("button", { name: "Rectangle" }).click();
  await page.getByRole("button", { name: "Use visible map area" }).click();
  let inspector = page.getByRole("article", { name: "Area data" });

  await inspector.getByRole("button", { name: "Theft: 9" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("9");
  await expect(inspector.getByRole("button", { name: "Assault: 0" })).toBeEnabled();
  await expect(inspector.getByRole("button", { name: "12:00: 3" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Tuesday: 2" })).toBeVisible();

  await inspector.getByRole("button", { name: "Assault: 0" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("14");
  await expect(inspector.getByRole("button", { name: "Theft: 9" })).toHaveAttribute("aria-pressed", "true");
  await expect(inspector.getByRole("button", { name: "Assault: 5" })).toHaveAttribute("aria-pressed", "true");
  await inspector.getByRole("button", { name: "Remove Assault filter" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("9");

  await inspector.getByRole("button", { name: "12:00: 3" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("3");
  await expect(inspector.getByRole("button", { name: "Tuesday: 2" })).toBeVisible();
  await inspector.getByRole("button", { name: "Tuesday: 2" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("2");
  await expect(inspector.getByRole("button", { name: "12:00: 2" })).toHaveAttribute("aria-pressed", "true");

  await inspector.getByText("View exact values").first().click();
  await expect(inspector.locator(".mc-chart-data").first().getByRole("row", { name: /12:00 2/ })).toBeVisible();

  await inspector.getByRole("button", { name: "Close area data" }).click();
  await page.getByRole("button", { name: "View area data" }).click();
  inspector = page.getByRole("article", { name: "Area data" });
  await expect(inspector.getByRole("button", { name: "Remove Tuesday filter" })).toBeVisible();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("2");

  await inspector.getByText("Redraw").click();
  await inspector.getByRole("button", { name: "Lasso" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "View area data" }).click();
  inspector = page.getByRole("article", { name: "Area data" });
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("2");

  await inspector.getByRole("tab", { name: "Data" }).click();
  const pageRequestPromise = page.waitForRequest((request) => {
    if (!request.url().endsWith("/dashboard/area-selection/records")) return false;
    const body = request.postDataJSON();
    return body.page_size === 25;
  });
  await inspector.getByRole("combobox", { name: "Rows" }).selectOption("25");
  const pageRequest = await pageRequestPromise;
  expect(pageRequest.postDataJSON()).toMatchObject({
    selected_types: ["THEFT"],
    selected_hours: [12],
    selected_days: [1],
    page_size: 25,
  });

  const exportRequestPromise = page.waitForRequest((request) => request.url().endsWith("/exports/area-selection.csv"));
  await inspector.getByRole("button", { name: "Export CSV" }).click();
  const exportRequest = await exportRequestPromise;
  expect(exportRequest.postDataJSON()).toMatchObject({
    selected_types: ["THEFT"],
    selected_hours: [12],
    selected_days: [1],
  });

  await inspector.getByRole("tab", { name: "Summary" }).click();
  await inspector.getByRole("button", { name: "Remove Tuesday filter" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("3");
  await inspector.getByRole("button", { name: "Clear filters" }).click();
  await expect(inspector.locator(".mc-area-total > strong")).toHaveText("18");
  await inspector.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("article", { name: "Area data" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear area" })).toHaveCount(0);
});
