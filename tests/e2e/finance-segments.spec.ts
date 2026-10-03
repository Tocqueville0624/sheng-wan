import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { businessFixture } from "../fixtures/finance/business-fixtures";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

const reported = {
  MCD: [4393e6, 2525e6, 182e6],
  TSLA: [20006e6, 146e6, 364e6, 3139e6, 4581e6],
  IBM: [7927e6, 9049e6, 186e6],
  WMT: [125939e6, 35624e6, 26367e6, 7e6],
  JNJ: [16384e6, 8926e6],
  APD: [1670.9e6, 1387e6, 103.1e6],
  AMAT: [7040e6, 1781e6, 294e6],
  DHR: [1920e6, 1879e6, 2466e6],
  AOS: [816.3e6, 188e6],
  AOSAnnual: [2964.4e6, 865.8e6],
  DOV: [283481000, 594959000, 305101000, 552709000, 455097000]
};

for (const ticker of [
  "MCD",
  "TSLA",
  "IBM",
  "WMT",
  "JNJ",
  "APD",
  "AMAT",
  "DHR",
  "AOS",
  "AOSAnnual",
  "DOV"
] as const) {
  test(`${ticker}: imported business sources retain their amounts, proportions and export provenance`, async ({
    page
  }, info) => {
    const { company, period } =
      ticker === "WMT" ||
      ticker === "JNJ" ||
      ticker === "APD" ||
      ticker === "AMAT" ||
      ticker === "DHR" ||
      ticker === "AOS" ||
      ticker === "AOSAnnual" ||
      ticker === "DOV"
        ? reviewedFixture(ticker)
        : businessFixture(ticker);
    expect(period.segments!.map((segment) => segment.revenue)).toEqual(reported[ticker]);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${company.ticker}&period=${period.kind}&statement=${period.id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary")).toContainText(company.name);
    const history = page.locator(".history-chart");
    await expect(history).toBeVisible();
    const chart = page.locator(".flow-chart");
    if (ticker !== "IBM" && ticker !== "APD" && ticker !== "AOSAnnual")
      expect(period.coverage.sankey).toBe(true);
    if (period.coverage.sankey) {
      await expect(chart).toBeVisible();
      await expect(chart.locator('[data-flow-bar^="segment-"]')).toHaveCount(
        reported[ticker].length
      );
      const revenueHeight = Number(
        await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
      );
      for (const segment of period.segments!) {
        const node = chart.locator(`[data-flow-node="segment-${segment.id}"]`);
        await expect(node).toBeVisible();
        const height = Number(
          await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
        );
        expect(height / revenueHeight).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
      }
      if (ticker === "MCD") {
        await expect(chart.locator('[data-flow-node="gross"]')).toHaveCount(0);
        await expect(chart.locator('[data-flow-node="adjustment-source-rounding"]')).toContainText(
          "Source rounding"
        );
        await page
          .locator(".flow-panel")
          .getByText("View exact amounts and reconciliation", { exact: true })
          .click();
        await expect(
          page
            .locator(".flow-panel")
            .getByRole("row")
            .filter({ hasText: "Source rounding · decrease" })
        ).toContainText("−$1,000,000");
      }
      if (ticker === "DOV") {
        await expect(chart.locator('[data-flow-node="revenue-base"]')).toContainText(
          /Pre-adjustment\s*revenue/
        );
        await expect(
          chart.locator('[data-flow-node="adjustment-reported-intersegment-eliminations"]')
        ).toContainText(/Intersegment\s*eliminations/);
        await page
          .locator(".flow-panel")
          .getByText("View exact amounts and reconciliation", { exact: true })
          .click();
        await expect(
          page
            .locator(".flow-panel")
            .getByRole("row")
            .filter({ hasText: "Intersegment eliminations · decrease" })
        ).toContainText("−$1,326,000");
      }
      if (ticker === "TSLA") {
        await expect(chart.locator('[data-flow-node="noncontrolling"]')).toContainText("$14M");
        await expect(
          chart.locator("[data-flow-node]").filter({ hasText: "Total automotive revenues" })
        ).toHaveCount(0);
      }
    } else {
      const label =
        period.kind === "annual"
          ? `FY ${period.fiscalYear}`
          : `Q${period.fiscalQuarter} FY${String(period.fiscalYear).slice(-2)}`;
      const bars = history.getByText(label, { exact: true }).first().locator("..").locator("rect");
      const heights = await bars.evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("height")))
      );
      expect(heights).toHaveLength(period.segments!.length);
      const height = heights.reduce((sum, value) => sum + value, 0);
      const revenue = period.segments!.reduce((sum, segment) => sum + segment.revenue, 0);
      heights.forEach((value, index) =>
        expect(value / height).toBeCloseTo(period.segments![index].revenue / revenue, 9)
      );
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const rendered of [history, ...(period.coverage.sankey ? [chart] : [])]) {
        const clipped = await rendered.evaluate((element) => {
          const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
          return [...element.querySelectorAll("text")]
            .filter((text) => {
              if (text.closest("[data-export-only]")) return false;
              const b = text.getBBox();
              return (
                b.x < -1 || b.y < -1 || b.x + b.width > width + 1 || b.y + b.height > height + 1
              );
            })
            .map((text) => text.textContent);
        });
        expect(clipped).toEqual([]);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
    }
    const group = page.getByRole("group", {
      name: `Download ${period.coverage.sankey ? "income statement Sankey" : "business revenue chart"}`
    });
    for (const format of ["SVG", "PNG"] as const) {
      const downloaded = page.waitForEvent("download");
      await group.getByRole("button", { name: format, exact: true }).click();
      const download = await downloaded;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${ticker.toLowerCase()}-business.${format.toLowerCase()}`);
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
        const proof = period.coverage.sankey ? metadata : metadata.periods[0];
        expect(proof.segments).toEqual(period.segments);
        expect(proof.businessBreakdownSource).toEqual(period.businessBreakdownSource);
        expect(proof.revenueAdjustments ?? []).toEqual(period.revenueAdjustments ?? []);
        expect(source).not.toMatch(/NaN|Infinity|<image[^>]+href="https?:/);
        expect(source).toContain(period.sourceUrl);
      } else {
        const metadata = await sharp(path).metadata();
        expect(metadata.width).toBeGreaterThan(3000);
        expect(metadata.height).toBeGreaterThan(2000);
        expect((await sharp(path).stats()).channels.some((channel) => channel.stdev > 20)).toBe(
          true
        );
      }
      await info.attach(`${ticker} business ${format}`, {
        path,
        contentType: format === "SVG" ? "image/svg+xml" : "image/png"
      });
    }
    if (ticker === "MCD") {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath("mcd-business-history.csv");
      await (await downloaded).saveAs(path);
      const csv = await readFile(path, "utf8");
      expect(csv).toContain(
        '"business_revenue","business_basis","business_provenance","revenue_adjustments"'
      );
      expect(csv).toContain("4393000000");
      expect(csv).toContain("statement-revenue-rows");
    }
    expect(errors).toEqual([]);
    const screenshot = info.outputPath(`${ticker.toLowerCase()}-business-page.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach(`${ticker} rendered business page`, {
      path: screenshot,
      contentType: "image/png"
    });
  });
}
