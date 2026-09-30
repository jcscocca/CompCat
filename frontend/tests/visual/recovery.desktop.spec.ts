import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./accessibilitySupport";
import { mockEmptyDashboard } from "./mockDashboard";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 320]) {
    test(`render recovery ${theme} at ${width}px protects details and reloads`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await mockEmptyDashboard(page, theme);
      // Replace only the first workspace module response, forcing the real App boundary.
      // Reload then loads the normal workspace; no crash switch is shipped in the app.
      await page.route("**/src/components/MapWorkspace.tsx", (route) => route.fulfill({
        contentType: "application/javascript",
        body: 'export function MapWorkspace() { throw new Error("PRIVATE_LOCATION 47.6005,-122.3315 raw API body /private/source.ts:42"); }',
      }), { times: 1 });
      const errors: string[] = [];
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      const heading = page.getByRole("heading", { name: "This page needs a fresh start" });
      await expect(heading).toBeFocused();
      // A crash on initial render precedes workspace theme initialization.
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await expect(page.getByRole("main")).not.toContainText(/PRIVATE_LOCATION|47\.6005|raw API body|source\.ts/);
      expect(errors.join("\n")).not.toMatch(/PRIVATE_LOCATION|47\.6005|raw API body|source\.ts/);
      await expectNoAxeViolations(page, `render recovery ${theme} at ${width}px`);
      await page.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.keyboard.press("Tab");
      const reload = page.getByRole("button", { name: "Reload CompCat" });
      await expect(reload).toBeFocused();
      expect(await reload.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "CompCat — reported Seattle incident context around addresses" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reload CompCat" })).toHaveCount(0);
    });
  }
}
