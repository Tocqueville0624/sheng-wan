import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import imported from "../fixtures/finance/imported-companies.json" with { type: "json" };
import { normalizeBasicCompany } from "../../scripts/finance/v2-model";
import type { CompanyV2 } from "../../src/features/finance/v2-types";
import { mockFinance } from "./finance-fixtures";

for (const original of imported.companies) {
  test(`${original.ticker}: imported SEC metrics produce a chart for every available period`, async ({
    page
  }) => {
    const company = normalizeBasicCompany(original as CompanyV2);
    await mockFinance(page, { [company.ticker]: company });
    await page.goto(`/playground/thales-olive/?ticker=${company.ticker}`);
    await expect(page.locator(".company-summary")).toContainText(company.name);
    for (const kind of ["annual", "quarterly"] as const) {
      await page
        .getByRole("button", {
          name: new RegExp(`^${kind === "annual" ? "Annual" : "Quarterly"} \\(`)
        })
        .click();
      await expect(page.locator(".basic-history-chart")).toBeVisible();
      for (const period of company[kind]) {
        await page.getByRole("combobox", { name: "Period", exact: true }).selectOption(period.id);
        const chart = page.locator(period.coverage.sankey ? ".flow-chart" : ".metrics-chart");
        await expect(chart).toBeVisible();
        await expect(chart).toContainText(period.label);
        const clipped = await chart.evaluate((element) => {
          const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
          return [...element.querySelectorAll("text")]
            .filter((text) => {
              const box = text.getBBox();
              return (
                box.x < 0 ||
                box.y < 0 ||
                box.x + box.width > width + 1 ||
                box.y + box.height > height + 1
              );
            })
            .map((text) => text.textContent);
        });
        expect(clipped).toEqual([]);
        if (!period.coverage.sankey) {
          for (const metric of [
            "revenue",
            "grossProfit",
            "operatingIncome",
            "pretaxIncome",
            "incomeTax",
            "netIncome"
          ] as const) {
            const row = chart.locator(`[data-metric="${metric}"]`);
            const value = period.metrics[metric];
            if (value === undefined) {
              await expect(row).toContainText("Not available");
              await expect(row.locator("rect")).toHaveCount(0);
            } else if (value < 0) {
              await expect(row.locator("rect")).toHaveAttribute("fill", "#b95045");
            }
          }
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
  });
}

test("banking metrics and history export as standalone SVG and PNG without business data", async ({
  page
}, info) => {
  const company = normalizeBasicCompany(
    imported.companies.find((c) => c.ticker === "JPM")! as CompanyV2
  );
  await mockFinance(page, { JPM: company });
  await page.goto("/playground/thales-olive/?ticker=JPM");
  await expect(page.locator(".metrics-chart")).toBeVisible();
  for (const label of ["financial metrics chart", "consolidated financial history"]) {
    for (const format of ["SVG", "PNG"] as const) {
      const event = page.waitForEvent("download");
      await page
        .getByRole("group", { name: `Download ${label}` })
        .getByRole("button", { name: format, exact: true })
        .click();
      const download = await event;
      const path = info.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      if (format === "SVG") {
        const source = await readFile(path, "utf8");
        expect(source).toContain(company.annual.at(-1)!.sourceUrl);
        expect(source).not.toMatch(/<image[^>]+href="https?:/);
        expect(source).not.toContain("NaN");
      } else {
        const metadata = await sharp(path).metadata();
        expect(metadata.width).toBeGreaterThanOrEqual(3000);
        expect(metadata.height).toBeGreaterThan(1900);
        const stats = await sharp(path).stats();
        expect(stats.channels.some((channel) => channel.stdev > 20)).toBe(true);
      }
    }
  }
  await page.locator(".metrics-chart").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("jpm-metrics.png") });
});
