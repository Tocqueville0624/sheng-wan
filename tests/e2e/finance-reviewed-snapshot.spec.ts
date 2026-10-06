import { test, expect } from "@playwright/test";
import snapshot from "../../src/data/generated/finance-reviewed/0001103982.json" with { type: "json" };

test("reviewed saved statements render through the actual asset/API path without a SEC task", async ({
  page,
  request
}) => {
  const response = await request.get("/api/finance/v2/companies/MDLZ");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.savedSourceSnapshot.checkedAt).toBe(snapshot.checkedAt);
  expect(data.company.quarterly.at(-1).id).toBe("2026-Q2");
  await page.goto("/playground/thales-olive/?ticker=MDLZ&period=quarterly&statement=2026-Q2");
  const chart = page.locator('.flow-chart[data-signed-accounting="true"]');
  await expect(chart).toBeVisible();
  const period = snapshot.quarterly.at(-1)!;
  const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
  expect(metadata.metrics).toEqual(period.metrics);
  expect(metadata.afterTaxTransactionItems).toEqual(period.afterTaxTransactionItems);
  const revenueHeight = Number(
    await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
  );
  for (const segment of period.segments!) {
    const height = Number(
      await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
    );
    expect(height / revenueHeight).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
});

test("a throttled enabled update preserves the checked diagram", async ({ page, request }) => {
  // CI's Worker correctly disables mutations. Load its actual checked data,
  // then model the enabled-update response without making a real SEC request.
  const source = await request.get("/api/finance/v2/companies/MDLZ");
  expect(source.ok()).toBe(true);
  const data = await source.json();
  await page.route("**/api/finance/v2/companies/MDLZ", (route) =>
    route.fulfill({ json: { ...data, available: true, job: null } })
  );
  await page.route("**/api/finance/v2/companies/MDLZ/refresh", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "60" },
      json: {
        error: {
          code: "RATE_LIMITED",
          message: "SEC update is temporarily limited. Saved data remains available."
        }
      }
    })
  );
  await page.goto("/playground/thales-olive/?ticker=MDLZ&period=annual&statement=FY2025");
  const chart = page.locator('.flow-chart[data-signed-accounting="true"]');
  await expect(chart).toBeVisible();
  const before = await chart.locator("metadata").textContent();
  await page.getByRole("button", { name: "Check latest SEC filings", exact: true }).click();
  await expect(
    page.getByText("SEC update is temporarily limited. Saved data remains available.", {
      exact: true
    })
  ).toBeVisible();
  expect(await chart.locator("metadata").textContent()).toBe(before);
});
