import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

function describeViolations(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations.map((violation) => {
    const nodes = violation.nodes.map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? "failed"}`).join("\n");
    return `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${nodes}`;
  }).join("\n\n");
}

export async function expectNoAxeViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, `${state}\n${describeViolations(results.violations)}`).toEqual([]);
}
