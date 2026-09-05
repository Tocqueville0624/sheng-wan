import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import history from "../../src/data/generated/finance-history.json" with { type: "json" };
import type { CompanyResponse } from "../../src/features/finance/v2-types";
import { validateV2 } from "../../scripts/finance/v2-model";

// Reads real validated snapshots. These checks never queue a financial import.
for (const featured of history.companies) {
  test(`${featured.ticker} exposes its full history and exports every sourced row`, async ({
    page,
    request
  }, info) => {
    test.setTimeout(60000);
    const response = await request.get(`/api/finance/v2/companies/${featured.ticker}`);
    expect(response.ok()).toBe(true);
    const { company } = (await response.json()) as CompanyResponse;
    expect(company).toBeTruthy();
    validateV2(company!);
    expect(company!.annual).toHaveLength(10);
    expect(company!.quarterly).toHaveLength(20);
    if (info.project.name === "mobile") await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/playground/thales-olive/?ticker=${featured.ticker}`);
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary")).toContainText(company!.name);
    for (const kind of ["annual", "quarterly"] as const) {
      const periods = company![kind];
      await page
        .getByRole("button", {
          name: kind === "annual" ? "Annual (10 years)" : "Quarterly (20 quarters)"
        })
        .click();
      const select = page.getByRole("combobox", { name: "Period", exact: true });
      await expect(select.locator("option")).toHaveCount(periods.length);
      await select.selectOption(periods[0].id);
      await expect(page.locator(".company-summary")).toContainText(periods[0].label);
      const region = page.getByRole("region", { name: "Financial history table" });
      await expect(region.locator("tbody tr")).toHaveCount(periods.length);
      await region.focus();
      await region.press("End");
      await expect.poll(() => region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download CSV" }).click();
      const download = await downloaded;
      const path = info.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      const csv = await readFile(path, "utf8");
      const rows = csv
        .trim()
        .split("\n")
        .map((line) =>
          [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m) => m[1].replaceAll('""', '"'))
        );
      expect(rows).toHaveLength(periods.length + 1);
      expect(rows[0]).toContain("gross_profit_adjustments");
      for (const [i, period] of periods.entries()) {
        expect(rows[i + 1][2]).toBe(period.label);
        expect(Number(rows[i + 1][4])).toBe(period.metrics.revenue);
        expect(Number(rows[i + 1][7])).toBe(period.metrics.netIncome);
        expect(rows[i + 1][8]).toBe(period.sourceUrl);
        expect(JSON.parse(rows[i + 1][12])).toEqual(period.grossProfitAdjustments ?? []);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      ).toBe(true);
    }
    if (featured.ticker === "TSM") {
      for (const format of ["SVG", "PNG"] as const) {
        const pending = page.waitForEvent("download");
        await page
          .getByRole("group", { name: "Download business revenue chart" })
          .getByRole("button", { name: format, exact: true })
          .click();
        const download = await pending;
        const path = info.outputPath(`tsm-20-quarters.${format.toLowerCase()}`);
        await download.saveAs(path);
        if (format === "SVG") {
          const svg = await readFile(path, "utf8");
          for (const period of company!.quarterly) expect(svg).toContain(period.segmentSourceUrl!);
          expect(svg).not.toContain("var(--");
          expect(svg).toContain("data:image/");
        } else {
          const metadata = await sharp(path).metadata();
          expect(metadata.width).toBeGreaterThanOrEqual(4000);
          expect(metadata.height).toBeGreaterThan(2000);
        }
      }
      await page.locator(".company-summary").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("tsm-history.png") });
    }
  });
}
