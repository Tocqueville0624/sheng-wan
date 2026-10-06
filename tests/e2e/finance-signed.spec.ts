import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

for (const key of [
  "FLEXGrossOperatingFY2020",
  "FLEXGrossOperatingFY2021",
  "FLEXGrossOperatingFY2022",
  "FLEXGrossOperatingFY2023",
  "FLEXGrossOperatingFY2024",
  "FLEXGrossOperatingFY2025",
  "FLEXGrossOperatingFY2026",
  "FLEXGrossOperating2022Q2",
  "FLEXGrossOperating2022Q3",
  "FLEXGrossOperating2025Q1",
  "FLEXGrossOperating2025Q2",
  "FLEXGrossOperating2025Q3",
  "FLEXGrossOperating2026Q1",
  "FLEXGrossOperating2026Q2",
  "FLEXGrossOperating2026Q3",
  "FLEXGrossOperating2027Q1",
  "MDLZTransaction2026Q2",
  "MDLZTransactionFY2025",
  "MDLZTransactionFY2024",
  "MDLZTransaction2026Q1",
  "MDLZTransactionFY2016",
  "MDLZTransactionFY2022",
  "MDLZTransaction2023Q1",
  "MDLZTransaction2023Q2",
  "SPGISubtotalsQuarter",
  "CARRSubtotalsQuarter",
  "PLDSubtotalsQuarter",
  "SPGISubtotalsAnnual",
  "CARRSubtotalsAnnual",
  "PLDSubtotalsAnnual",

  "MRNASigned",
  "AXONSigned",
  "FSigned",
  "HPESigned",
  "APDOperatingAnnual",
  "APDOperatingQuarter",
  "APDOperating2021",
  "APDOperating2016",
  "CRLOperatingAnnual",
  "CRLOperatingQuarter",
  "AREDirectNetAnnual",
  "AREDirectNetQuarter",
  "AREDirectNet2017",
  "AREDirectNet2021Q3"
] as const)
  test(`${key}: original business revenue and signed stages render and export`, async ({
    page
  }, info) => {
    const { period, company } = reviewedFixture(key);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${company.ticker}&period=${period.kind}&statement=${period.id}`
    );
    const chart = page.locator('.flow-chart[data-signed-accounting="true"]');
    await expect(chart).toBeVisible();
    if (period.directNetItems) {
      await expect(chart.locator('[data-flow-node="operating"]')).toHaveCount(0);
      await expect(chart.locator('[data-flow-node="pretax"]')).toHaveCount(0);
      await expect(chart.locator('[data-flow-node="tax"]')).toHaveCount(0);
      await expect(chart.locator('[data-flow-node="total-expenses"]')).toContainText(
        "including interest"
      );
      await expect(chart.locator('[data-flow-node="consolidated-net"]')).toContainText(
        period.directNetItems.consolidated.amount < 0
          ? "Consolidated net loss"
          : "Consolidated net profit"
      );
    } else
      await expect(chart.locator('[data-flow-node="operating"]')).toContainText(
        period.metrics.operatingIncome! < 0 ? "Operating loss" : "Operating profit"
      );
    await expect(chart.locator('[data-flow-node="net"]')).toContainText(
      period.metrics.netIncome! < 0 ? /net loss/i : /net profit/i
    );
    const revenueHeight = Number(
      await chart.locator('[data-flow-bar="revenue"]').getAttribute("height")
    );
    for (const segment of period.segments ?? []) {
      const height = Number(
        await chart.locator(`[data-flow-bar="segment-${segment.id}"]`).getAttribute("height")
      );
      expect(height / revenueHeight).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
    }
    const metadata = JSON.parse((await chart.locator("metadata").textContent()) ?? "null");
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.flow).toBe("signed-accounting");
    if (period.grossOperatingItems) {
      expect(metadata.grossOperatingItems).toEqual(period.grossOperatingItems);
      for (const item of period.grossOperatingItems.grossCosts.filter((l) => l.amount > 0))
        await expect(chart.locator(`[data-flow-node="gross-cost-${item.id}"]`)).toContainText(
          "cost of sales"
        );
      for (const item of period.grossOperatingItems.operatingCosts.filter((l) => l.amount < 0)) {
        await expect(
          chart.locator(`[data-flow-node="operating-reversal-${item.id}"]`)
        ).toContainText("reversal");
        expect(
          metadata.nodes.find((n: { id: string }) => n.id === `operating-reversal-${item.id}`)
            .amount
        ).toBe(-item.amount);
      }
    }
    if (period.afterTaxTransactionItems) {
      expect(metadata.afterTaxTransactionItems).toEqual(period.afterTaxTransactionItems);
      const amount = period.metrics.afterTaxTransactionIncome!;
      if (amount === 0)
        await expect(chart.locator('[data-flow-node="after-tax-transaction"]')).toHaveCount(0);
      else {
        expect(
          metadata.nodes.find((n: { id: string }) => n.id === "after-tax-transaction").signedAmount
        ).toBe(amount);
        await expect(chart.locator('[data-flow-node="after-tax-transaction"]')).toContainText(
          amount < 0 ? /transaction loss.*after tax/s : /transaction gain.*after tax/s
        );
      }
    }
    if (period.operatingItems) {
      expect(metadata.operatingItems).toEqual(period.operatingItems);
      for (const item of period.operatingItems.items.filter(
        (r) => r.effect === "gain" && r.amount !== 0
      )) {
        expect(
          metadata.nodes.find((n: { id: string }) => n.id === `operating-item-${item.id}`)
            .signedAmount
        ).toBe(item.amount);
        await expect(chart.locator(`[data-flow-node="operating-item-${item.id}"]`)).toContainText(
          item.label
        );
      }
    }
    if (period.shareholderBridge) {
      expect(metadata.shareholderBridge).toEqual(period.shareholderBridge);
      expect(metadata.nodes.find((n: { id: string }) => n.id === "common-net").signedAmount).toBe(
        period.shareholderBridge.common.amount
      );
      await expect(chart.locator('[data-flow-node="common-net"]')).toContainText(
        period.shareholderBridge.common.amount < 0 ? "Net loss to common" : "Net income to common"
      );
    }
    if (period.directNetItems) {
      expect(metadata.directNetItems).toEqual(period.directNetItems);
      expect(
        metadata.nodes.find((n: { id: string }) => n.id === "consolidated-net").signedAmount
      ).toBe(period.directNetItems.consolidated.amount);
      for (const item of period.directNetItems.gains.filter((r) => r.amount !== 0)) {
        expect(
          metadata.nodes.find((n: { id: string }) => n.id === `direct-net-item-${item.id}`)
            .signedAmount
        ).toBe(item.amount);
        await expect(chart.locator(`[data-flow-node="direct-net-item-${item.id}"]`)).toContainText(
          item.label
        );
      }
    } else
      expect(metadata.nodes.find((n: { id: string }) => n.id === "operating").signedAmount).toBe(
        period.metrics.operatingIncome
      );
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
      if (
        period.directNetItems ||
        period.operatingItems?.costSubtotal ||
        period.afterTaxTransactionItems ||
        period.grossOperatingItems
      ) {
        const headerIntrusions = await chart.evaluate((element) =>
          [...element.querySelectorAll("[data-flow-node] text")]
            .filter((t) => (t as SVGTextElement).getBBox().y < 136)
            .map((t) => t.textContent)
        );
        expect(headerIntrusions).toEqual([]);
        const overlaps = await chart.evaluate((element) => {
          const texts = [...element.querySelectorAll("[data-flow-node] text")];
          return texts.flatMap((a, i) =>
            texts.slice(i + 1).flatMap((b) => {
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
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
      await chart.screenshot({
        path: info.outputPath(`${company.ticker}-${colorScheme}-chart.png`)
      });
    }
    for (const format of ["SVG", "PNG"] as const) {
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("group", { name: "Download income statement Sankey" })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await downloaded;
      expect(await download.failure()).toBeNull();
      const path = info.outputPath(`${company.ticker}-signed.${format.toLowerCase()}`);
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
        expect(source).not.toMatch(/NaN|Infinity/);
      } else expect((await sharp(path).metadata()).width).toBeGreaterThan(3000);
      await info.attach(`${company.ticker} ${format}`, {
        path,
        contentType: format === "SVG" ? "image/svg+xml" : "image/png"
      });
    }
    if (
      period.shareholderBridge ||
      period.operatingItems ||
      period.directNetItems ||
      period.afterTaxTransactionItems ||
      period.grossOperatingItems
    ) {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const download = await downloaded;
      const path = info.outputPath(`${company.ticker}-shareholder.csv`);
      await download.saveAs(path);
      const csv = await readFile(path, "utf8");
      expect(csv).toContain('"common_shareholder_income"');
      if (period.shareholderBridge) {
        expect(csv).toContain(`"${period.shareholderBridge.common.amount}"`);
        expect(csv).toContain(JSON.stringify(period.shareholderBridge).replaceAll('"', '""'));
      }
      if (period.operatingItems) {
        expect(csv).toContain('"operating_items"');
        expect(csv).toContain(JSON.stringify(period.operatingItems).replaceAll('"', '""'));
      }
      if (period.directNetItems) {
        expect(csv).toContain('"total_expenses"');
        expect(csv).toContain('"direct_net_items"');
        expect(csv).toContain(JSON.stringify(period.directNetItems).replaceAll('"', '""'));
      }
      if (period.afterTaxTransactionItems) {
        expect(csv).toContain('"after_tax_transaction_income"');
        expect(csv).toContain('"after_tax_transaction_items"');
        expect(csv).toContain(
          JSON.stringify(period.afterTaxTransactionItems).replaceAll('"', '""')
        );
      }
      if (period.grossOperatingItems) {
        expect(csv).toContain('"gross_operating_items"');
        expect(csv).toContain(JSON.stringify(period.grossOperatingItems).replaceAll('"', '""'));
        expect(csv).toContain(`"${period.metrics.operatingExpenses}"`);
      }
    }
    expect(errors).toEqual([]);
  });

for (const key of ["INTCSigned", "BDXSigned"] as const)
  test(`${key}: signed cost-detail layout remains readable and exports exact source values`, async ({
    page
  }, info) => {
    const { period, company } = reviewedFixture(key);
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(
      `/playground/thales-olive/?ticker=${company.ticker}&period=${period.kind}&statement=${period.id}`
    );
    const chart = page.locator('.flow-chart[data-signed-accounting="true"]');
    await expect(chart).toBeVisible();
    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata.metrics).toEqual(period.metrics);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
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
      await chart.screenshot({ path: info.outputPath(`${company.ticker}-${colorScheme}.png`) });
    }
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("group", { name: "Download income statement Sankey" })
      .getByRole("button", { name: "SVG", exact: true })
      .click();
    const download = await downloaded;
    const path = info.outputPath(`${company.ticker}-signed.svg`);
    await download.saveAs(path);
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
    expect(source).not.toMatch(/NaN|Infinity/);
    await info.attach(`${company.ticker} SVG`, { path, contentType: "image/svg+xml" });
  });
