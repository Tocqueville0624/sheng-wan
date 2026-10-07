import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import saved from "../fixtures/finance/amd-retained-income.json" with { type: "json" };
import type { PeriodV2 } from "../../src/features/finance/v2-types";
import { enrichAmdBusinessPeriods } from "../../scripts/finance/amd-business-v2";
import { enrichAmdIncomePeriods } from "../../scripts/finance/amd-income-v2";
import { parseInlineXbrl } from "../../scripts/finance/ixbrl";
import { originalAmdInlineIncome } from "../../src/features/finance/amd-inline-income";
import { amdFixture } from "../fixtures/finance/amd-fixture";
import { companyFromFilingPeriods } from "../../scripts/finance/current-filing";
import { mockFinance } from "./finance-fixtures";

const sourceCases = [
  ["AMD", "FY2025"],
  ["AMD", "2026-Q2"],
  ["AMD", "2026-Q1"],
  ["AMD", "2024-Q2"],
  ["AMD", "2023-Q1"],
  ["AMD", "2022-Q1"],
  ["AMD", "FY2020"],
  ["AMD", "FY2019"]
] as const;
const cases: {
  ticker: string;
  id: string;
  source: ReturnType<typeof amdFixture>;
  period: PeriodV2;
}[] = sourceCases.map(([ticker, id]) => ({
  ticker,
  id,
  source: amdFixture(id),
  period: amdFixture(id).source.expectedCurrent
}));
for (const original of saved.periods) {
  const prior = structuredClone(original) as PeriodV2,
    source = amdFixture(
      prior.id === "FY2017" ? "FY2019" : prior.id === "FY2021" ? "FY2023" : "FY2025"
    ),
    parsed = parseInlineXbrl(source.html),
    business = enrichAmdBusinessPeriods(
      source.html,
      source.identity,
      source.source.filing,
      [prior],
      parsed
    ),
    period = enrichAmdIncomePeriods(
      source.html,
      source.identity,
      source.source.filing,
      business.length ? business : [prior],
      parsed
    )[0];
  if (!period) throw Error("Missing original saved AMD income scope " + prior.id);
  cases.push({
    ticker: "AMD",
    id: ("saved-" + prior.id) as (typeof sourceCases)[number][1],
    source,
    period
  });
}
for (const { ticker, id, source: s, period } of cases)
  test(`${ticker} ${id}: original business leaves render proportionally and export their complete proof`, async ({
    page
  }, info) => {
    const company = companyFromFilingPeriods(s.identity, [period]);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockFinance(page, { [ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${ticker}&period=${period.kind}&statement=${period.id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    if (period.amdInlineIncome) {
      const scoped = originalAmdInlineIncome(period, period.amdInlineIncome);
      expect(metadata.chartMetrics).toEqual(scoped.metrics);
      expect(metadata.amdInlineIncome).toEqual(period.amdInlineIncome);
      expect(scoped.metrics.pretaxIncome! + scoped.metrics.equityMethodIncome!).toBe(
        period.metrics.pretaxIncome
      );
      await expect(chart).toContainText("Saved inclusive pretax metric:");
    }
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
    expect(JSON.parse(rows[1][rows[0].indexOf("amd_inline_income")])).toEqual(
      period.amdInlineIncome ?? null
    );
    expect(errors).toEqual([]);
  });
