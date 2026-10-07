import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { businessFixture } from "../fixtures/finance/business-fixtures";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import {
  standaloneBusinessFixture,
  sourceOnlyBusinessFixture
} from "../fixtures/finance/standalone-business-fixtures";
import {
  originalBusinessCases,
  originalBusinessFixture,
  type OriginalBusinessCase
} from "../fixtures/finance/original-business-fixtures";
import { mockFinance } from "./finance-fixtures";
import { albemarleInlineFixture } from "../fixtures/finance/albemarle-inline-income-fixtures";

const reported = {
  AgilentStandalone: [1992000000, 790000000, 1420000000],
  AgilentSourceOnlyStandalone: [1992000000, 790000000, 1420000000],
  UNHAnnual: [352229000000, 53380000000, 38038000000, 3920000000],
  UNHQuarter: [86956000000, 13835000000, 10018000000, 1223000000],
  UNHLegacyAnnual: [158453000000, 26366000000, 15317000000, 1023000000],
  UNHStandalone: [144118000000, 26658000000, 13236000000, 828000000],
  UNHSourceOnlyStandalone: [144118000000, 26658000000, 13236000000, 828000000],
  LRCXAnnual: [14885488000, 8347202000],
  LRCXQuarter: [3730582000, 2110906000],
  LRCXFirstQuarter: [3547565000, 1776608000],
  LRCXLegacyQuarter: [2307421000, 1148816000],
  HOODAnnual: [2628000000, 1514000000, 331000000],
  HOODQuarter: [776000000, 389000000, 143000000],
  HOODFirstQuarter: [623000000, 359000000, 85000000],
  HOODLegacyMillion: [1402000000, 256000000, 157000000],
  HOODLegacyThousand: [170831000, 70639000, 36063000],

  ALBOperatingGain: [320334000, 279748000, 148344000, 25470000],
  AMEStandalone: [2360281000, 1479806000],
  ALBStandalone: [668852000, 792425000, 1031501000, 180988000, 3437000],
  AMESourceOnlyStandalone: [2360281000, 1479806000],
  ALBSourceOnlyStandalone: [668852000, 792425000, 1031501000, 180988000, 3437000],
  GEHC2024Q2: [3207e6, 1632e6],
  GEHC2024Q3: [3201e6, 1662e6],
  GEHC2025Q1: [3117e6, 1660e6],
  GEHC2026Q2: [3416e6, 1878e6],
  KO: [8146e6, 5234e6],
  GRMN: [756823e3, 482740e3, 268749e3, 341369e3, 172411e3],
  LII: [935.6e6, 609.7e6],
  MAS: [1337e6, 655e6],
  VLTO: [908e6, 566e6],
  ABT: [1499e6, 2144e6, 3092e6, 5853e6, 5e6],
  ABTAnnual: [5536e6, 8451e6, 8937e6, 21387e6, 17e6],
  MCD: [4393e6, 2525e6, 182e6],
  MMM: [3091e6, 2066e6, 1247e6, 96e6],
  MMMAnnual: [11384e6, 8272e6, 4920e6, 372e6],
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
  "AgilentStandalone",
  "AgilentSourceOnlyStandalone",
  "UNHAnnual",
  "UNHQuarter",
  "UNHLegacyAnnual",
  "UNHStandalone",
  "UNHSourceOnlyStandalone",
  "LRCXAnnual",
  "LRCXQuarter",
  "LRCXFirstQuarter",
  "LRCXLegacyQuarter",
  "HOODAnnual",
  "HOODQuarter",
  "HOODFirstQuarter",
  "HOODLegacyMillion",
  "HOODLegacyThousand",

  "ALBOperatingGain",
  "AMEStandalone",
  "ALBStandalone",
  "AMESourceOnlyStandalone",
  "ALBSourceOnlyStandalone",
  "GEHC2024Q2",
  "GEHC2024Q3",
  "GEHC2025Q1",
  "GEHC2026Q2",
  "KO",
  "GRMN",
  "LII",
  "MAS",
  "VLTO",
  "ABT",
  "ABTAnnual",
  "MCD",
  "MMM",
  "MMMAnnual",
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
      ticker in originalBusinessCases
        ? originalBusinessFixture(ticker as OriginalBusinessCase)
        : ticker === "AgilentStandalone"
          ? await standaloneBusinessFixture("A")
          : ticker === "AgilentSourceOnlyStandalone"
            ? await sourceOnlyBusinessFixture("A")
            : ticker === "UNHStandalone"
              ? await standaloneBusinessFixture("UNH")
              : ticker === "UNHSourceOnlyStandalone"
                ? await sourceOnlyBusinessFixture("UNH")
                : ticker === "ALBOperatingGain"
                  ? albemarleInlineFixture()
                  : ticker === "AMESourceOnlyStandalone" || ticker === "ALBSourceOnlyStandalone"
                    ? await sourceOnlyBusinessFixture(
                        ticker === "AMESourceOnlyStandalone" ? "AME" : "ALB"
                      )
                    : ticker === "AMEStandalone" || ticker === "ALBStandalone"
                      ? await standaloneBusinessFixture(ticker === "AMEStandalone" ? "AME" : "ALB")
                      : ticker === "GEHC2024Q2" ||
                          ticker === "GEHC2024Q3" ||
                          ticker === "GEHC2025Q1" ||
                          ticker === "GEHC2026Q2" ||
                          ticker === "ABT" ||
                          ticker === "ABTAnnual" ||
                          ticker === "WMT" ||
                          ticker === "MMM" ||
                          ticker === "MMMAnnual" ||
                          ticker === "JNJ" ||
                          ticker === "APD" ||
                          ticker === "AMAT" ||
                          ticker === "DHR" ||
                          ticker === "KO" ||
                          ticker === "GRMN" ||
                          ticker === "LII" ||
                          ticker === "MAS" ||
                          ticker === "VLTO" ||
                          ticker === "AOS" ||
                          ticker === "AOSAnnual" ||
                          ticker === "DOV"
                        ? reviewedFixture(ticker)
                        : businessFixture(ticker as "IBM" | "MCD" | "TSLA");
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
    if (!["IBM", "APD", "AOSAnnual"].includes(ticker)) expect(period.coverage.sankey).toBe(true);
    if (period.coverage.sankey) {
      await expect(chart).toBeVisible();
      if (ticker === "ALBOperatingGain") {
        const n = (id: string) => chart.locator(`[data-flow-node="${id}"]`);
        await expect(n("operating-reversal-alb-inline-income-9")).toContainText("$429.41M");
        await expect(n("equity")).toContainText("$18M");
        await expect(n("noncontrolling")).toContainText("$21.61M");
        await expect(n("opex")).toContainText("$135.49M");
        await expect(n("opex")).toContainText("before business-sale gains");
        expect(period.metrics.operatingExpenses).toBe(-293916000);
      }
      if (ticker === "ALBStandalone" || ticker === "ALBSourceOnlyStandalone") {
        const n = (id: string) => chart.locator(`[data-flow-node="${id}"]`);
        await expect(n("operating-reversal-alb-original-income-9")).toContainText("$122.3M");
        await expect(n("equity")).toContainText("$59.64M");
        await expect(n("discontinued")).toContainText("$202.13M");
        await expect(n("noncontrolling")).toContainText("$37.09M");
        await expect(n("opex")).toContainText("before business-sale gains");
        expect(period.metrics.operatingExpenses).toBe(369326000);
      }
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
      if (ticker === "LII" || ticker === "MAS") {
        await expect(chart.locator('[data-flow-node="opex"]')).toContainText(
          /Operating expenses\s*and\s*other items\s*\(net\)/
        );
        await expect(
          chart.locator(
            '[data-flow-node="other-opex"], [data-flow-node="sga"], [data-flow-node="rd"]'
          )
        ).toHaveCount(0);
      }
      if (period.roundedOperatingExpenseComponents) {
        await expect(
          chart.locator(
            '[data-flow-node="rd"], [data-flow-node="sga"], [data-flow-node="other-opex"]'
          )
        ).toHaveCount(0);
        await expect(chart).toContainText("Rounded expense components do not exactly partition");
      }
      for (const [id, adjustment] of [
        ["operating-rounding", period.operatingReconciliation],
        ["after-tax-rounding", period.afterTaxReconciliation]
      ] as const) {
        if (!adjustment) continue;
        const height = Number(
          await chart.locator(`[data-flow-bar="${id}"]`).getAttribute("height")
        );
        expect(height / revenueHeight).toBeCloseTo(
          Math.abs(adjustment.amount) / period.metrics.revenue!,
          9
        );
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
      if (ticker === "MMM" || ticker === "MMMAnnual") {
        await expect(chart.locator('[data-flow-node="subsidiary"]')).toContainText(
          /Unconsolidated\s*subsidiary/
        );
        await expect(chart.locator('[data-flow-node="equity"]')).toHaveCount(0);
        const revenueHeight = Number(
          await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
        );
        const subsidiaryHeight = Number(
          await chart.locator('[data-flow-bar="subsidiary"]').getAttribute("height")
        );
        expect(subsidiaryHeight / revenueHeight).toBeCloseTo(
          period.metrics.afterTaxSubsidiaryIncome! / period.metrics.revenue!,
          9
        );
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
        if (period.coverage.sankey) {
          expect(proof.grossOperatingItems).toEqual(period.grossOperatingItems);
          expect(proof.metrics).toEqual(period.metrics);
          expect(proof.operatingExpensesBasis).toEqual(period.operatingExpensesBasis);
          expect(proof.operatingReconciliation).toEqual(period.operatingReconciliation);
          expect(proof.afterTaxReconciliation).toEqual(period.afterTaxReconciliation);
          expect(proof.consolidatedIncomeSubtotal).toEqual(period.consolidatedIncomeSubtotal);
          expect(proof.roundedOperatingExpenseComponents).toEqual(
            period.roundedOperatingExpenseComponents
          );
        }
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
    if (ticker.startsWith("UNH")) {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath(`${ticker.toLowerCase()}-original-revenue.csv`);
      await (await event).saveAs(path);
      const csv = await readFile(path, "utf8");
      const rows = csv
        .trim()
        .split(/\r?\n/)
        .map((line) =>
          [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(([, value]) =>
            value.replaceAll('""', '"')
          )
        );
      const head = rows[0],
        selected = rows.slice(1).find((row) => row[head.indexOf("period")] === period.label)!;
      expect(selected).toBeDefined();
      expect(JSON.parse(selected[head.indexOf("business_provenance")])).toEqual(
        period.businessBreakdownSource
      );
      for (const segment of period.segments!) expect(csv).toContain(String(segment.revenue));
      await info.attach(`${ticker} original CSV`, { path, contentType: "text/csv" });
    }
    if (ticker.startsWith("GEHC")) {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath(`${ticker.toLowerCase()}-source-precision.csv`);
      await (await downloaded).saveAs(path);
      const csv = await readFile(path, "utf8");
      expect(csv).toContain(
        '"after_tax_reconciliation","consolidated_income_subtotal","rounded_operating_expense_components"'
      );
      expect(csv).toContain(String(period.metrics.netIncome));
      if (period.roundedOperatingExpenseComponents)
        expect(csv).toContain(String(period.roundedOperatingExpenseComponents.difference));
      if (period.consolidatedIncomeSubtotal)
        expect(csv).toContain(String(period.consolidatedIncomeSubtotal.amount));
    }
    if (ticker === "LII" || ticker === "MAS") {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath(`${ticker.toLowerCase()}-net-operating-items.csv`);
      await (await downloaded).saveAs(path);
      const csv = await readFile(path, "utf8");
      expect(csv).toContain('"operating_expenses_basis","operating_expenses"');
      expect(csv).toContain(`"expenses-and-other-items-net","${period.metrics.operatingExpenses}"`);
    }
    if (ticker === "ALBOperatingGain") {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath("alb-original-signed-operating-gain.csv");
      await (await downloaded).saveAs(path);
      const csv = await readFile(path, "utf8");
      const rows = csv
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          return [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(([, value]) =>
            value.replaceAll('""', '"')
          );
        });
      expect(rows).toHaveLength(2);
      expect(rows[1]).toHaveLength(rows[0].length);
      const field = (name: string) => rows[1][rows[0].indexOf(name)];
      expect(field("operating_expenses")).toBe("-293916000");
      expect(JSON.parse(field("gross_operating_items"))).toEqual(period.grossOperatingItems);
      expect(JSON.parse(field("business_provenance"))).toEqual(period.businessBreakdownSource);
      for (const segment of period.segments!) expect(csv).toContain(String(segment.revenue));
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
    if (ticker.endsWith("Standalone")) {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const path = info.outputPath(`${ticker.toLowerCase()}-original-source-history.csv`);
      await (await downloaded).saveAs(path);
      const csv = await readFile(path, "utf8");
      expect(csv).toContain("reviewed-original-standalone-revenue");
      expect(csv).toContain("original-separate-xbrl-html-v1");
      for (const segment of period.segments!) expect(csv).toContain(String(segment.revenue));
      expect(csv).toContain(
        period.businessBreakdownSource!.standaloneRevenue!.source.instanceSource.url
      );
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
