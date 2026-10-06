import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { reviewedFixture } from "../fixtures/finance/reviewed-fixtures";
import { mockFinance } from "./finance-fixtures";

for (const key of [
  "MRNASigned",
  "AXONSigned",
  "FSigned",
  "HPESigned",
  "APDOperatingAnnual",
  "APDOperatingQuarter",
  "APDOperating2021",
  "APDOperating2016",
  "CRLOperatingAnnual",
  "CRLOperatingQuarter"
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
        "Net loss to common"
      );
    }
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
    if (period.shareholderBridge || period.operatingItems) {
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
