import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

for (const key of [
  "CHDBusinessFY2025",
  "CHDBusiness2026Q2",
  "CHDBusinessFY2017",
  "AKAMServicesFY2025",
  "AKAMServices2026Q2",
  "AKAMServicesFY2017",
  "AKAMServices2021Q3",
  "ALBBusinessFY2025",
  "ALBBusiness2026Q2",
  "ALBBusinessFY2017",
  "ALBBusinessFY2021",
  "AMEBusinessFY2025",
  "AMEBusiness2026Q2",
  "AMEBusinessFY2017",
  "AMEBusinessFY2021",
  "AMEBusiness2020Q1"
] as const)
  test(`${key}: original business revenue partition renders proportionally and exports`, async ({
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
    expect(period.segments!.length).toBeGreaterThanOrEqual(2);
    if (company.ticker === "ALB") {
      expect(metadata.businessBreakdownSource.method).toBe("reviewed-albemarle-revenue");
      expect(metadata.businessBreakdownSource.albemarleRevenue.primary.tableIndex).toBe(
        period.kind === "annual" ? 1 : 0
      );
    } else if (company.ticker === "AME") {
      expect(metadata.businessBreakdownSource.method).toBe("reviewed-ametek-revenue");
      expect(metadata.businessBreakdownSource.ametekRevenue.primary.title).toBe(
        "AMETEK, Inc. Consolidated Statement of Income"
      );
      expect(metadata.segments.map((s: { label: string }) => s.label)).toEqual([
        "Electronic Instruments",
        "Electromechanical"
      ]);
    } else if (company.ticker === "CHD") {
      expect(metadata.businessBreakdownSource.method).toBe("reviewed-church-dwight-revenue");
      expect(metadata.businessBreakdownSource.churchDwightRevenue.rows).toHaveLength(6);
      expect(metadata.segments.map((s: { label: string }) => s.label)).toEqual([
        "Household Products",
        "Personal Care Products",
        "Total Consumer International",
        "Total SPD"
      ]);
    } else {
      expect(metadata.businessBreakdownSource.method).toBe("reviewed-service-revenue-rows");
      expect(metadata.businessBreakdownSource.serviceRevenueRows.primary.tableIndex).toBe(0);
    }
    expect(
      metadata.segments.every(
        (s: { revenueSource: { calculation?: unknown } }) => !s.revenueSource.calculation
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
        path: info.outputPath(`${company.ticker}-service-revenue-page-${colorScheme}.png`)
      });
    }
    await page
      .locator(".flow-panel")
      .screenshot({ path: info.outputPath(`${company.ticker}-service-revenue-page.png`) });
    for (const format of ["SVG", "PNG"] as const) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("group", { name: "Download income statement Sankey" })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await pending;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${company.ticker}-service-revenue.${format.toLowerCase()}`);
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
    const path = info.outputPath(`${company.ticker}-service-revenue.csv`);
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
