import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

test("positive after-tax source rounding and minority loss retain their own scale and exported evidence", async ({
  page
}, info) => {
  const { period, company } = reviewedFixture("CMCSAPrecision");
  expect(period.coverage.sankey).toBe(true);
  await mockFinance(page, { CMCSA: company });
  await page.goto(`/playground/thales-olive/?ticker=CMCSA&period=quarterly&statement=${period.id}`);
  const chart = page.locator(".flow-chart");
  await expect(chart).toBeVisible();
  const revenueHeight = Number(
    await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
  );
  for (const [id, amount] of [
    ["after-tax-rounding", 1e6],
    ["noncontrolling", 107e6]
  ] as const) {
    const height = Number(await chart.locator(`[data-flow-bar="${id}"]`).getAttribute("height"));
    expect(height / revenueHeight).toBeCloseTo(amount / period.metrics.revenue!, 9);
  }
  await expect(chart.locator('[data-flow-node="net"]')).toContainText("$3.53B");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    const clipped = await chart.evaluate((element) => {
      const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
      return [...element.querySelectorAll("text")]
        .filter((t) => {
          const b = t.getBBox();
          return b.x < -1 || b.y < -1 || b.x + b.width > width + 1 || b.y + b.height > height + 1;
        })
        .map((t) => t.textContent);
    });
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
  }
  for (const format of ["SVG", "PNG"] as const) {
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("group", { name: "Download income statement Sankey" })
      .getByRole("button", { name: format, exact: true })
      .click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`cmcsa-source-precision.${format.toLowerCase()}`);
    await download.saveAs(path);
    if (format === "SVG") {
      const source = await readFile(path, "utf8");
      const metadata = await page.evaluate(
        (source) =>
          JSON.parse(
            new DOMParser().parseFromString(source, "image/svg+xml").querySelector("metadata")!
              .textContent!
          ),
        source
      );
      expect(metadata.metrics).toEqual(period.metrics);
      expect(metadata.afterTaxReconciliation).toEqual(period.afterTaxReconciliation);
      expect(metadata.consolidatedIncomeSubtotal).toEqual(period.consolidatedIncomeSubtotal);
      expect(source).not.toMatch(/NaN|Infinity/);
    } else {
      const png = await sharp(path).metadata();
      expect(png.width).toBeGreaterThan(3000);
    }
    await info.attach(`Comcast ${format}`, {
      path,
      contentType: format === "SVG" ? "image/svg+xml" : "image/png"
    });
  }
});
