import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

for (const key of [
  "ABBVProductFY2025",
  "ABBVProduct2026Q2",
  "ABBVProductFY2020",
  "ABBVProduct2022Q1"
] as const)
  test(`${key}: original calculated product portfolio partition renders proportionally and exports`, async ({
    page
  }, info) => {
    const { company, period } = reviewedFixture(key);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${company.ticker}&period=${period.kind}&statement=${period.id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary h2")).toHaveText(company.name);
    await expect(page.locator(".flow-period-select select")).toHaveValue(period.id);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.segments).toEqual(period.segments);
    expect(metadata.businessBreakdownSource).toEqual(period.businessBreakdownSource);
    expect(period.segments!.length).toBeGreaterThanOrEqual(6);
    expect(metadata.businessBreakdownSource.method).toBe("reported-product-portfolios");
    expect(metadata.businessBreakdownSource.productPortfolios.primary.tableIndex).toBe(0);
    expect(
      metadata.segments.every(
        (s: { revenueSource: { calculation: { method: string } } }) =>
          s.revenueSource.calculation.method === "sum-of-reported-products"
      )
    ).toBe(true);
    const revenueHeight = Number(
      await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
    );
    for (const segment of period.segments ?? []) {
      const height = Number(
        await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
      );
      expect(height / revenueHeight).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
    }
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      const theme = page.getByRole("button", { name: "Switch color theme" });
      const opened = !(await theme.isVisible());
      if (opened) await page.getByRole("button", { name: "Open navigation" }).click();
      for (
        let i = 0;
        i < 2 && (await page.locator("html").getAttribute("data-theme")) !== colorScheme;
        i++
      )
        await theme.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      if (opened) await page.getByRole("button", { name: "Open navigation" }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      const clipped = await chart.evaluate((element) => {
        const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
        return [...element.querySelectorAll("text")]
          .filter((text) => {
            const b = text.getBBox();
            return b.x < -1 || b.y < -1 || b.x + b.width > width + 1 || b.y + b.height > height + 1;
          })
          .map((text) => text.textContent);
      });
      expect(clipped).toEqual([]);
      const overlaps = await chart.evaluate((element) => {
        const texts = [...element.querySelectorAll("[data-flow-node] text")];
        return texts.flatMap((a, index) =>
          texts.slice(index + 1).flatMap((b) => {
            if (a.parentElement === b.parentElement) return [];
            const x = (a as SVGTextElement).getBBox(),
              y = (b as SVGTextElement).getBBox();
            return Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 0.5 &&
              Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 0.5
              ? [[a.textContent, b.textContent]]
              : [];
          })
        );
      });
      expect(overlaps).toEqual([]);
      await page.locator(".flow-panel").screenshot({
        path: info.outputPath(`${company.ticker}-product-portfolios-page-${colorScheme}.png`)
      });
    }
    await page
      .locator(".flow-panel")
      .screenshot({ path: info.outputPath(`${company.ticker}-product-portfolios-page.png`) });
    for (const format of ["SVG", "PNG"] as const) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("group", { name: "Download income statement Sankey" })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await pending;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${company.ticker}-product-portfolios.${format.toLowerCase()}`);
      await download.saveAs(path);
      if (format === "SVG") {
        const svg = await readFile(path, "utf8");
        const exported = await page.evaluate(
          (source) =>
            JSON.parse(
              new DOMParser().parseFromString(source, "image/svg+xml").querySelector("metadata")!
                .textContent!
            ),
          svg
        );
        expect(exported).toEqual(metadata);
        expect(svg).toContain(period.sourceUrl);
      } else {
        const image = await sharp(path).metadata();
        expect(image.format).toBe("png");
        expect(image.width).toBeGreaterThan(3000);
      }
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`${company.ticker}-product-portfolios.csv`);
    await download.saveAs(path);
    const rows = (await readFile(path, "utf8"))
      .split("\n")
      .map((line) =>
        [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) =>
          match[1]!.replaceAll('""', '"')
        )
      );
    expect(JSON.parse(rows[1]![rows[0]!.indexOf("business_revenue")]!)).toEqual(period.segments);
    expect(JSON.parse(rows[1]![rows[0]!.indexOf("business_provenance")]!)).toEqual(
      period.businessBreakdownSource
    );
    expect(errors).toEqual([]);
  });
