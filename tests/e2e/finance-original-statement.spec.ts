import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import pairs from "../fixtures/finance/original-statement-source-pairs.json" with { type: "json" };
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { companyFromFilingPeriods } from "../../scripts/finance/current-filing";
import { mergeV2 } from "../../scripts/finance/v2-model";
import { mockFinance } from "./finance-fixtures";

test("corroborated CHD original keeps the entire prior source in SVG and CSV", async ({
  page
}, info) => {
  const f = pairs.rows[0];
  const identity = f.identity as CatalogCompany;
  const company = mergeV2(
    companyFromFilingPeriods(identity, [f.prior as PeriodV2]),
    companyFromFilingPeriods(identity, [f.original as PeriodV2])
  );
  const period = company.quarterly[0];
  await mockFinance(page, { CHD: company });
  await page.goto("/playground/thales-olive/?ticker=CHD&period=quarterly&statement=2026-Q1");
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await expect(page.locator(".flow-chart")).toBeVisible();
  await expect(page.locator(".flow-panel")).toContainText(
    "Both source records are retained in SVG and CSV downloads."
  );
  const metadata = JSON.parse((await page.locator(".flow-chart metadata").textContent())!);
  expect(metadata.originalStatementCorroboration.prior).toEqual(f.prior);
  expect(metadata.metrics.netIncome).toBe(f.prior.metrics.netIncome);
  const total = Number(await page.locator('[data-flow-bar="revenue"]').getAttribute("height"));
  for (const s of period.segments!) {
    const height = Number(
      await page.locator(`[data-flow-bar="segment-${s.id}"]`).getAttribute("height")
    );
    expect(height / total).toBeCloseTo(s.revenue / period.metrics.revenue!, 9);
  }
  const svgEvent = page.waitForEvent("download");
  await page
    .getByRole("group", { name: "Download income statement Sankey" })
    .getByRole("button", { name: "SVG", exact: true })
    .click();
  const svg = await svgEvent;
  const svgPath = info.outputPath("original-source.svg");
  await svg.saveAs(svgPath);
  const source = await readFile(svgPath, "utf8");
  const exported = await page.evaluate(
    (text) =>
      JSON.parse(
        new DOMParser().parseFromString(text, "image/svg+xml").querySelector("metadata")!
          .textContent!
      ),
    source
  );
  expect(exported.originalStatementCorroboration.prior).toEqual(f.prior);
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV", exact: true }).click();
  const csv = await csvEvent;
  const csvPath = info.outputPath("original-source.csv");
  await csv.saveAs(csvPath);
  const rows = (await readFile(csvPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(([, value]) => value.replaceAll('""', '"'))
    );
  const column = rows[0].indexOf("original_statement_corroboration");
  expect(column).toBeGreaterThan(0);
  expect(JSON.parse(rows[1][column]).prior).toEqual(f.prior);
});
