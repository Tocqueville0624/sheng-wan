import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { dardenFixture } from "../fixtures/finance/darden-fixture";
import { companyFromFilingPeriods } from "../../scripts/finance/current-filing";
import { mockFinance } from "./finance-fixtures";

for (const [ticker, id] of [
  ["DRI", "FY2018"],
  ["DRI", "FY2026"],
  ["DRI", "2024-Q1"],
  ["DRI", "2024-Q2"],
  ["DRI", "2024-Q3"],
  ["DRI", "2026-Q3"],
  ["DRI", "2027-Q1"]
] as const)
  test(`${ticker} ${id}: original business leaves render proportionally and export their complete proof`, async ({
    page
  }, info) => {
    const s = dardenFixture(id),
      period = s.period,
      company = companyFromFilingPeriods(s.identity, [period]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockFinance(page, { [ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${ticker}&period=${period.kind}&statement=${id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.businessBreakdownSource).toEqual(period.businessBreakdownSource);
    expect(metadata.segments).toEqual(period.segments);
    expect(metadata.revenueAdjustments).toEqual(period.revenueAdjustments);
    const h = Number(await chart.locator('[data-flow-bar="revenue"]').getAttribute("height"));
    for (const segment of period.segments!) {
      const branch = chart.locator(`[data-flow-bar="segment-${segment.id}"]`);
      expect(Number(await branch.getAttribute("height")) / h).toBeCloseTo(
        segment.revenue / period.metrics.revenue!,
        9
      );
    }
    expect(metadata.dardenInlineIncome).toEqual(period.dardenInlineIncome);
    if (period.dardenInlineIncome)
      await expect(page.locator(".flow-panel")).toContainText(
        "tax-benefit figures embedded in the line label"
      );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const toggle = page.getByRole("button", { name: "Switch color theme" }),
        menu = page.getByRole("button", { name: "Open navigation" });
      const opened = !(await toggle.isVisible());
      if (opened) await menu.click();
      for (
        let i = 0;
        i < 2 && (await page.locator("html").getAttribute("data-theme")) !== theme;
        i++
      )
        await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (opened) await menu.click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
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
      const overlaps = await chart.evaluate((element) => {
        // Wrapped SVG text has a rectangular aggregate box spanning empty
        // space beside shorter lines. Compare actual rendered lines instead.
        const texts = [
          ...element.querySelectorAll(
            "[data-flow-node] text > tspan, [data-flow-node] text:not(:has(tspan))"
          )
        ];
        return texts.flatMap((a, i) =>
          texts.slice(i + 1).flatMap((b) => {
            if (a.closest("[data-flow-node]") === b.closest("[data-flow-node]")) return [];
            const x = (a as SVGGraphicsElement).getBBox(),
              y = (b as SVGGraphicsElement).getBBox();
            return Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > 0.5 &&
              Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > 0.5
              ? [[a.textContent, b.textContent]]
              : [];
          })
        );
      });
      expect(overlaps).toEqual([]);
      await page
        .locator(".flow-panel")
        .screenshot({ path: info.outputPath(`${ticker}-${id}-${theme}.png`) });
    }
    for (const format of ["SVG", "PNG"] as const) {
      const pending = page.waitForEvent("download");
      await page
        .getByRole("group", { name: "Download income statement Sankey" })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await pending;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${ticker}-${id}.${format.toLowerCase()}`);
      await download.saveAs(path);
      if (format === "SVG") {
        const source = await readFile(path, "utf8");
        const exported = await page.evaluate(
          (source) =>
            JSON.parse(
              new DOMParser().parseFromString(source, "image/svg+xml").querySelector("metadata")!
                .textContent!
            ),
          source
        );
        expect(exported).toEqual(metadata);
      } else {
        const image = await sharp(path).metadata();
        expect(image.format).toBe("png");
        expect(image.width).toBeGreaterThan(3000);
      }
    }
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const download = await pending;
    const path = info.outputPath(`${ticker}-${id}.csv`);
    await download.saveAs(path);
    const rows = (await readFile(path, "utf8"))
      .split("\n")
      .map((line) =>
        [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1].replaceAll('""', '"'))
      );
    expect(JSON.parse(rows[1][rows[0].indexOf("business_provenance")])).toEqual(
      period.businessBreakdownSource
    );
    expect(JSON.parse(rows[1][rows[0].indexOf("business_revenue")])).toEqual(period.segments);
    expect(JSON.parse(rows[1][rows[0].indexOf("darden_inline_income")])).toEqual(
      period.dardenInlineIncome ?? null
    );
    expect(errors).toEqual([]);
  });
