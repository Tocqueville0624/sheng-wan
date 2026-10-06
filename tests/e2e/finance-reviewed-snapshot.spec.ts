import { test, expect } from "@playwright/test";
import snapshot from "../../src/data/generated/finance-reviewed/0001103982.json" with { type: "json" };
import albemarle from "../../src/data/generated/finance-reviewed/0000915913.json" with { type: "json" };

test("Albemarle actual saved asset/API path retains complete original businesses and corrected historical years", async ({
  page,
  request
}) => {
  const response = await request.get("/api/finance/v2/companies/ALB");
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.savedSourceSnapshot.checkedAt).toBe(albemarle.checkedAt);
  expect(data.company.annual.find((p: { id: string }) => p.id === "FY2021").endDate).toBe(
    "2021-12-31"
  );
  expect(data.company.annual.find((p: { id: string }) => p.id === "FY2022").endDate).toBe(
    "2022-12-31"
  );
  for (const kind of ["annual", "quarterly"] as const) {
    const period = albemarle[kind].at(-1)!;
    await page.goto(`/playground/thales-olive/?ticker=ALB&period=${kind}&statement=${period.id}`);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.segments).toEqual(period.segments);
    expect(metadata.businessBreakdownSource).toEqual(period.businessBreakdownSource);
    const total = Number(await chart.locator('[data-flow-bar="revenue"]').getAttribute("height"));
    for (const segment of period.segments!) {
      const height = Number(
        await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
      );
      expect(height / total).toBeCloseTo(segment.revenue / period.metrics.revenue, 9);
    }
  }
});

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
  // CI's Worker correctly disables mutations. Keep its actual checked data
  // and identities, but model one consistently enabled service for both reads.
  const [source, catalog] = await Promise.all([
    request.get("/api/finance/v2/companies/MDLZ"),
    request.get("/api/finance/v2/catalog")
  ]);
  expect(source.ok()).toBe(true);
  expect(catalog.ok()).toBe(true);
  const data = await source.json();
  const catalogData = await catalog.json();
  await page.route("**/api/finance/v2/catalog", (route) =>
    route.fulfill({ json: { ...catalogData, available: true } })
  );
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
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  const chart = page.locator('.flow-chart[data-signed-accounting="true"]');
  await expect(chart).toBeVisible();
  const before = await chart.locator("metadata").textContent();
  const update = page.getByRole("button", { name: "Check latest SEC filings", exact: true });
  await expect(update).toBeEnabled();
  await update.click();
  await expect(
    page.getByText("SEC update is temporarily limited. Saved data remains available.", {
      exact: true
    })
  ).toBeVisible();
  expect(await chart.locator("metadata").textContent()).toBe(before);
});
