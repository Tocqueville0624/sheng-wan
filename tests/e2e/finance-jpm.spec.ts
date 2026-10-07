import cloudRetained from "../fixtures/finance/jpm-original-retained-basic.json" with { type: "json" };
import { readGenericFiling } from "../../scripts/finance/generic-import";
import { mergeV2 } from "../../scripts/finance/v2-model";
import type { CompanyV2 } from "../../src/features/finance/v2-types";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { jpmFixture } from "../fixtures/finance/jpm-fixture";
import { companyFromFilingPeriods } from "../../scripts/finance/current-filing";
import { mockFinance } from "./finance-fixtures";

for (const id of [
  "FY2025",
  "2026-Q2",
  "2024-Q2",
  "FY2021",
  "FY2018",
  "FY2016-comparison",
  "FY2025-retained-basic"
] as const) {
  test(`JPM ${id}: complete original business proportions, signed contributions and export provenance`, async ({
    page
  }, info) => {
    const s = jpmFixture(
        id === "FY2016-comparison" ? "FY2018" : id === "FY2025-retained-basic" ? "FY2025" : id
      ),
      period =
        id === "FY2016-comparison"
          ? s.source.retained.find((r) => r.expected.id === "FY2016")!.expected
          : id === "FY2025-retained-basic"
            ? (() => {
                const prior = (cloudRetained.company as CompanyV2).annual.find(
                    (p) => p.id === "FY2025"
                  )!,
                  before = companyFromFilingPeriods(s.identity, [prior]),
                  candidate = readGenericFiling(
                    s.html,
                    s.identity,
                    s.source.filing,
                    before,
                    []
                  ).find((p) => p.id === prior.id)!;
                return mergeV2(before, companyFromFilingPeriods(s.identity, [candidate])).annual[0];
              })()
            : s.source.expectedCurrent,
      company = companyFromFilingPeriods(s.identity, [period]),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockFinance(page, { JPM: company });
    await page.goto(
      `/playground/thales-olive/?ticker=JPM&period=${period.kind}&statement=${period.id}`
    );
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary")).toContainText(company.name);
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    const revenue = Number(await chart.locator('[data-flow-bar="revenue"]').getAttribute("height"));
    expect(await chart.locator('[data-flow-bar^="segment-"]').count()).toBe(
      period.segments!.length
    );
    for (const branch of period.segments!) {
      await expect(chart.locator(`[data-flow-node="segment-${branch.id}"]`)).toBeVisible();
      const height = Number(
        await chart.locator(`[data-flow-bar="segment-${branch.id}"]`).getAttribute("height")
      );
      expect(height / revenue).toBeCloseTo(branch.revenue / period.metrics.revenue!, 9);
    }
    for (const branch of period.revenueAdjustments!) {
      await expect(chart.locator(`[data-flow-node="adjustment-${branch.id}"]`)).toBeVisible();
      const height = Number(
        await chart.locator(`[data-flow-bar="adjustment-${branch.id}"]`).getAttribute("height")
      );
      expect(height / revenue).toBeCloseTo(-branch.revenue / period.metrics.revenue!, 9);
    }
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const button = page.getByRole("button", { name: "Switch color theme" }),
        opened = !(await button.isVisible());
      if (opened) await page.getByRole("button", { name: "Open navigation" }).click();
      for (
        let i = 0;
        i < 2 && (await page.locator("html").getAttribute("data-theme")) !== theme;
        i++
      )
        await button.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (opened) await page.getByRole("button", { name: "Open navigation" }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      expect(
        await chart.evaluate((element) => {
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
        })
      ).toEqual([]);
    }
    const group = page.getByRole("group", { name: "Download income statement Sankey" });
    for (const format of ["SVG", "PNG"] as const) {
      const event = page.waitForEvent("download");
      await group.getByRole("button", { name: format, exact: true }).click();
      const download = await event;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`jpm-${id}.${format.toLowerCase()}`);
      await download.saveAs(path);
      if (format === "SVG") {
        const svg = await readFile(path, "utf8"),
          metadata = await page.evaluate(
            (text) =>
              JSON.parse(
                new DOMParser().parseFromString(text, "image/svg+xml").querySelector("metadata")!
                  .textContent!
              ),
            svg
          );
        expect(metadata.metrics).toEqual(period.metrics);
        expect(metadata.segments).toEqual(period.segments);
        expect(metadata.revenueAdjustments).toEqual(period.revenueAdjustments);
        expect(metadata.businessBreakdownSource).toEqual(period.businessBreakdownSource);
        expect(svg).toContain(period.sourceUrl);
      } else {
        const m = await sharp(path).metadata();
        expect(m.width).toBeGreaterThan(3000);
        expect(m.height).toBeGreaterThan(2000);
      }
      await info.attach(`JPM ${id} ${format}`, {
        path,
        contentType: format === "SVG" ? "image/svg+xml" : "image/png"
      });
    }
    const csvEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const csv = await csvEvent,
      path = info.outputPath(`jpm-${id}.csv`);
    await csv.saveAs(path);
    const text = await readFile(path, "utf8"),
      rows = text
        .trim()
        .split(/\r?\n/)
        .map((line) =>
          [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(([, v]) => v.replaceAll('""', '"'))
        ),
      header = rows[0],
      row = rows[1];
    expect(rows.length).toBe(2);
    expect(JSON.parse(row[header.indexOf("business_provenance")])).toEqual(
      period.businessBreakdownSource
    );
    for (const branch of period.segments!) expect(text).toContain(String(branch.revenue));
    if (info.project.name === "mobile") {
      const region = page.getByRole("region", { name: "Scrollable income statement Sankey" });
      await region.focus();
      await region.evaluate((e) => (e.scrollLeft = 0));
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => region.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}
