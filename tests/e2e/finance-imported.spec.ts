import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import imported from "../fixtures/finance/imported-companies.json" with { type: "json" };
import { normalizeBasicCompany } from "../../scripts/finance/v2-model";
import { enrichInlinePeriods } from "../../scripts/finance/inline-v2";
import type { CompanyV2 } from "../../src/features/finance/v2-types";
import { mockFinance } from "./finance-fixtures";

test("MCD's reported quarterly statement renders and exports a direct operating-profit Sankey", async ({
  page
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const original = normalizeBasicCompany(
    imported.companies.find((company) => company.ticker === "MCD")! as CompanyV2
  );
  const period = original.quarterly.find((entry) => entry.id === "2026-Q2")!;
  const html = await readFile(
    new URL("../fixtures/finance/mcd-2026-q2-inline.html", import.meta.url),
    "utf8"
  );
  const [enhanced] = enrichInlinePeriods(
    html,
    {
      ticker: original.ticker,
      name: original.name,
      cik: original.cik,
      sector: "Consumer Discretionary",
      universe: "sp500"
    },
    {
      accession: period.accession!,
      filedAt: period.filedAt,
      reportDate: period.endDate,
      form: "10-Q",
      primaryDocument: "mcd-20260630.htm",
      sourceUrl: period.sourceUrl,
      directoryUrl: new URL(".", period.sourceUrl).href
    },
    [period]
  );
  expect(enhanced.coverage.sankey).toBe(true);
  expect(enhanced.metrics.grossProfit).toBeUndefined();
  const company = {
    ...original,
    quarterly: original.quarterly.map((entry) => (entry.id === enhanced.id ? enhanced : entry))
  };
  await mockFinance(page, { MCD: company });
  await page.goto("/playground/thales-olive/?ticker=MCD&period=quarterly&statement=2026-Q2");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".company-summary")).toContainText("McDonald's");
  const chart = page.locator(".flow-chart");
  await expect(chart).toBeVisible();
  await expect(chart).toContainText("Q2 FY2026");
  await expect(page.locator(".metrics-chart")).toHaveCount(0);
  await expect(chart.locator('[data-flow-node="gross"]')).toHaveCount(0);
  await expect(chart.locator('[data-flow-node="cost"]')).toHaveCount(0);
  await expect(chart.locator('[data-flow-node="operating-costs"]')).toContainText("$3.76B");
  await expect(chart.locator('[data-flow-node="operating-rounding"]')).toContainText(
    "Source rounding"
  );
  await expect(chart).toContainText("No gross profit is estimated.");
  const dimensions = await chart.evaluate((element) => {
    const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
    const clipped = [...element.querySelectorAll("text")]
      .filter((text) => {
        const box = text.getBBox();
        return (
          box.x < 0 || box.y < 0 || box.x + box.width > width + 1 || box.y + box.height > height + 1
        );
      })
      .map((text) => text.textContent);
    return { width, height, clipped };
  });
  expect(dimensions.clipped).toEqual([]);
  await page
    .locator(".flow-panel")
    .getByText("View exact amounts and reconciliation", { exact: true })
    .click();
  const roundingRow = page
    .locator(".flow-panel")
    .getByRole("row")
    .filter({ hasText: "Source rounding" });
  await expect(roundingRow).toContainText("reported-precision decrease");
  await expect(roundingRow).toContainText("−$1,000,000");
  await expect(
    page.locator(".flow-panel").getByRole("rowheader", { name: "Gross profit", exact: true })
  ).toHaveCount(0);
  await expect(page.locator(".flow-panel")).toContainText("reported totals remain unchanged");

  for (const format of ["SVG", "PNG"] as const) {
    const event = page.waitForEvent("download");
    await page
      .getByRole("group", { name: "Download income statement Sankey" })
      .getByRole("button", { name: format, exact: true })
      .click();
    const download = await event;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`mcd-q2-direct-flow.${format.toLowerCase()}`);
    await download.saveAs(path);
    await info.attach(`MCD direct flow ${format}`, {
      path,
      contentType: format === "SVG" ? "image/svg+xml" : "image/png"
    });
    if (format === "SVG") {
      const source = await readFile(path, "utf8");
      const exported = await page.evaluate((svgSource) => {
        const doc = new DOMParser().parseFromString(svgSource, "image/svg+xml");
        return {
          ...JSON.parse(doc.querySelector("metadata")!.textContent!),
          renderedText: doc.documentElement.textContent
        };
      }, source);
      expect(exported.flow).toBe("direct-operating");
      expect(exported.metrics).toEqual(enhanced.metrics);
      expect(exported.metricSources).toEqual(enhanced.metricSources);
      expect(exported.operatingReconciliation).toEqual({
        label: "Source rounding",
        amount: -1e6,
        sourceUrl: period.sourceUrl
      });
      expect(
        Object.fromEntries(
          exported.nodes.map((node: { id: string; amount: number }) => [node.id, node.amount])
        )
      ).toMatchObject({
        revenue: 7099e6,
        "operating-costs": 3760e6,
        operating: 3338e6,
        pretax: 2936e6,
        tax: 574e6,
        net: 2362e6,
        "operating-rounding": 1e6
      });
      expect(exported.nodes.some((node: { id: string }) => node.id === "gross")).toBe(false);
      expect(exported.metricSources.pretaxIncome.tag).toBe(
        "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes"
      );
      expect(exported.metricSources.totalOperatingCosts.tag).toBe("us-gaap:CostsAndExpenses");
      expect(source).toContain(period.sourceUrl);
      expect(exported.renderedText).toContain("Source rounding: −$1M");
      expect(source).not.toMatch(/<image[^>]+href="https?:/);
      expect(source).not.toMatch(/NaN|Infinity/);
    } else {
      const metadata = await sharp(path).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(Math.trunc(dimensions.width * 3));
      expect(metadata.height).toBe(Math.trunc(dimensions.height * 3));
      const stats = await sharp(path).stats();
      expect(stats.channels.some((channel) => channel.stdev > 20)).toBe(true);
      const footer = await sharp(path)
        .extract({ left: 0, top: metadata.height! - 280, width: metadata.width!, height: 280 })
        .stats();
      expect(footer.channels.some((channel) => channel.stdev > 3)).toBe(true);
    }
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mcd-direct-flow.png"), fullPage: true });
});

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
