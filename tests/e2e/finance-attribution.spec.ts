import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import facts from "../fixtures/finance/tsla-2026-q2-facts.json" with { type: "json" };
import { extractFactsV2 } from "../../scripts/finance/facts-v2";
import type { SecFiling } from "../../scripts/finance/sec-shared";
import catalog from "../../src/data/generated/finance-catalog.json" with { type: "json" };
import type { CatalogCompany } from "../../src/features/finance/v2-types";
import { mockFinance } from "./finance-fixtures";

const filing: SecFiling = {
  accession: "0001628280-26-049270",
  filedAt: "2026-07-23",
  reportDate: "2026-06-30",
  form: "10-Q",
  primaryDocument: "tsla-20260630.htm",
  directoryUrl: "https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/tsla-20260630.htm"
};

// Each theme runs under the configured desktop and mobile browser projects.
for (const colorScheme of ["light", "dark"] as const) {
  test(`Tesla's ${colorScheme} Sankey preserves reported parent and noncontrolling income`, async ({
    page
  }, info) => {
    const identity = catalog.companies.find((entry) => entry.ticker === "TSLA")! as CatalogCompany;
    const company = extractFactsV2(facts, identity, [filing]);
    const period = company.quarterly.find((entry) => entry.id === "2026-Q2")!;
    expect(period.coverage.sankey).toBe(true);
    expect(period.metrics.netIncome).toBe(1114e6);
    expect(period.metrics.noncontrollingInterestIncome).toBe(14e6);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await mockFinance(page, { TSLA: company });
    await page.goto("/playground/thales-olive/?ticker=TSLA&period=quarterly&statement=2026-Q2");
    await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
    await expect(page.locator(".company-summary")).toContainText("Tesla");
    const chart = page.locator(".flow-chart");
    await expect(chart).toBeVisible();
    await expect(chart).toContainText("Q2 FY2026");
    await expect(page.locator(".metrics-chart")).toHaveCount(0);
    const parent = chart.locator('[data-flow-node="net"]');
    const noncontrolling = chart.locator('[data-flow-node="noncontrolling"]');
    await expect(parent).toContainText("Net profit to parent");
    await expect(parent).toContainText("$1.11B");
    await expect(noncontrolling).toContainText(/Profit to\s*noncontrolling\s*interests/);
    await expect(noncontrolling).toContainText("$14M");

    const metadata = JSON.parse((await chart.locator("metadata").textContent())!);
    expect(metadata).toMatchObject({
      ticker: "TSLA",
      period: "2026-Q2",
      sourceUrl: filing.sourceUrl,
      metrics: { netIncome: 1114e6, noncontrollingInterestIncome: 14e6 },
      metricSources: {
        netIncome: {
          tag: "us-gaap:NetIncomeLoss",
          method: "reported",
          accession: filing.accession,
          filedAt: filing.filedAt,
          sourceUrl: filing.sourceUrl
        },
        noncontrollingInterestIncome: {
          tag: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
          method: "reported",
          accession: filing.accession,
          filedAt: filing.filedAt,
          sourceUrl: filing.sourceUrl
        }
      },
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "net", label: "Net profit to parent", amount: 1114e6 }),
        expect.objectContaining({ id: "noncontrolling", amount: 14e6 })
      ])
    });
    expect(metadata.metrics.netIncome).not.toBe(1128e6);
    expect(metadata.metrics.netIncome).not.toBe(1116e6);
    expect(metadata.metrics).toEqual(period.metrics);
    expect(metadata.metricSources).toEqual(period.metricSources);

    const bounds = await chart.evaluate((element) => {
      const { width, height } = (element as SVGSVGElement).viewBox.baseVal;
      const labels = [...element.querySelectorAll("text")].map((text) => ({
        text: text.textContent,
        box: text.getBBox()
      }));
      const clipped = labels
        .filter(
          ({ box }) =>
            box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > width + 1 ||
            box.y + box.height > height + 1
        )
        .map(({ text }) => text);
      const overlapping = labels.flatMap((label, index) =>
        labels
          .slice(index + 1)
          .filter(
            (other) =>
              Math.min(label.box.x + label.box.width, other.box.x + other.box.width) -
                Math.max(label.box.x, other.box.x) >
                1 &&
              Math.min(label.box.y + label.box.height, other.box.y + other.box.height) -
                Math.max(label.box.y, other.box.y) >
                1
          )
          .map((other) => [label.text, other.text])
      );
      return { clipped, overlapping };
    });
    expect(bounds.clipped).toEqual([]);
    expect(bounds.overlapping).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true
    );
    const panel = page.locator(".flow-panel");
    await panel.getByText("View exact amounts and reconciliation", { exact: true }).click();
    await expect(panel.getByRole("row").filter({ hasText: "Net profit to parent" })).toContainText(
      "$1,114,000,000"
    );
    await expect(
      panel.getByRole("row").filter({ hasText: "Profit to noncontrolling interests" })
    ).toContainText("$14,000,000");

    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: "SVG", exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = info.outputPath(`tsla-q2-attribution-${colorScheme}.svg`);
    await download.saveAs(path);
    const source = await readFile(path, "utf8");
    const exported = await page.evaluate((svgSource) => {
      const doc = new DOMParser().parseFromString(svgSource, "image/svg+xml");
      return JSON.parse(doc.querySelector("metadata")!.textContent!);
    }, source);
    expect(exported).toEqual(metadata);
    expect(source).toContain(filing.sourceUrl);
    expect(source).not.toMatch(/NaN|Infinity|<image[^>]+href="https?:/);
    await info.attach(`Tesla attribution ${colorScheme} SVG`, {
      path,
      contentType: "image/svg+xml"
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
