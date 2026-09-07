import { expect, test } from "@playwright/test";

import { mockEmptyDashboard, sharedReport, waitForSharedReport } from "./mockDashboard";

test("print opens an isolated tab and waits for saved-place privacy revalidation", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  const report = { ...sharedReport, report_id: "saved-report" };
  await page.route("**/dashboard/reports", (route) => route.fulfill({ json: report }));
  let releaseValidation!: () => void;
  const validation = new Promise<void>((resolve) => { releaseValidation = resolve; });
  await page.route("**/dashboard/reports/saved-report", async (route) => {
    await validation;
    await route.fulfill({ json: report });
  });
  await waitForSharedReport(page);
  await page.getByText("Export", { exact: true }).click();

  const opened = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Print / save PDF" }).click();
  const printable = await opened;
  await expect(printable.locator("body")).toHaveText("Preparing your report…");
  expect(await printable.evaluate(() => window.opener)).toBeNull();

  releaseValidation();

  await expect(printable.getByRole("heading", { name: report.profile.report_title })).toBeVisible();
  expect(await printable.evaluate(() => window.opener)).toBeNull();
  await expect(printable.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.getByText(/This report could not be exported|Allow pop-ups/)).toHaveCount(0);
});

test("a blocked print tab reports popup guidance instead of a privacy error", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await waitForSharedReport(page);
  await page.evaluate(() => { window.open = () => null; });
  await page.getByText("Export", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Print / save PDF" }).click();

  await expect(page.getByRole("alert")).toHaveText("Allow pop-ups for CompCat, then try printing again.");
  expect(page.context().pages()).toHaveLength(1);
});

test("a rejected saved-place export closes its empty print tab", async ({ page }) => {
  await mockEmptyDashboard(page, "light");
  await page.route("**/dashboard/reports", (route) => route.fulfill({
    json: { ...sharedReport, report_id: "erased-report" },
  }));
  await page.route("**/dashboard/reports/erased-report", (route) => route.fulfill({
    status: 409, json: { detail: "Saved place became sensitive." },
  }));
  await waitForSharedReport(page);
  await page.getByText("Export", { exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Print / save PDF" }).click();
  const printable = await opened;

  await expect.poll(() => printable.isClosed()).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Saved-place privacy settings may have changed.");
});
