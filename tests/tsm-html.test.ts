import { describe, expect, it } from "vitest";
import {
  extractTsmHtml,
  extractTsmAnnualHtml,
  tsmQuarterlyExhibit
} from "../scripts/finance/tsm-html";
import { convertPeriodToUsd } from "../scripts/finance/extract";
import { validatePeriod } from "../scripts/finance/validate";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { SecFiling } from "../scripts/finance/sec-shared";

// Deliberately small synthetic values exercise the parser, never the public
// dataset. Cell layout mirrors TSM's SEC quarterly statement exhibits.
const source = "https://www.sec.gov/Archives/edgar/data/1046179/example/report.htm";
const filed = "2026-08-14";
const row = (cells: (number | string)[]) =>
  `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
function fixture(quarter = "June 30", fullYearToDate = true) {
  const years = fullYearToDate ? [2026, 2025, 2026, 2025] : [2026, 2025];
  const numbers = (current: number) =>
    fullYearToDate
      ? [current, current * 0.9, current * 2, current * 1.8]
      : [current, current * 0.9];
  const amountRow = (label: string, current: number) =>
    row([label, ...numbers(current).flatMap((n) => ["$", n, "100"])]);
  const platformRow = (label: string, current: number) =>
    row([label, ...numbers(current).flatMap((n) => ["$", n])]);
  return `<h1>Taiwan Semiconductor Manufacturing Company Limited and Subsidiaries</h1>
    <h2>CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME</h2>
    <p>(In Thousands of New Taiwan Dollars, Except Earnings Per Share)</p>
    <table>${row([`Three Months Ended ${quarter}`])}${row(years)}
      ${row(years.flatMap(() => ["Amount", "%"]))}
      ${amountRow("NET REVENUE (Notes 20, 31 and 37)", 100)}
      ${amountRow("COST OF REVENUE (Notes 12, 27, 31 and 34)", 60)}
      ${amountRow("GROSS PROFIT", 40)}
      ${amountRow("INCOME FROM OPERATIONS (Note 37)", 20)}
      ${amountRow("INCOME BEFORE INCOME TAX", 30)}
      ${amountRow("INCOME TAX EXPENSE (Notes 4 and 24)", 5)}
      ${amountRow("NET INCOME", 25)}
      ${amountRow("Research and development", 10)}
    </table>
    <table>${row([`Three Months Ended ${quarter}`])}${row(["Platform", ...years])}
      ${platformRow("High Performance Computing", 60)}
      ${platformRow("Smartphone", 20)}
      ${platformRow("Internet of Things", 10)}
      ${platformRow("Automotive", 5)}
      ${platformRow("Digital Consumer Electronics", 3)}
      ${platformRow("Others", 2)}
    </table>`;
}

describe("TSM quarterly SEC HTML statement extraction", () => {
  it("uses a described legacy exhibit and explicit period end, deduplicating repeated inline links", () => {
    const filing = {
      directoryUrl: "https://www.sec.gov/Archives/edgar/data/1046179/example/",
      filedAt: "2022-08-12"
    } as SecFiling;
    const html = `<table><tr><td><a href="tsm-ex991_18.htm">Consolidated Financial Statements for the Six Months Ended June 3<span>0</span>, </a><a href="tsm-ex991_18.htm">2022 and 2021</a></td></tr></table>`;
    expect(tsmQuarterlyExhibit(html, filing)).toEqual({
      url: filing.directoryUrl + "tsm-ex991_18.htm",
      reportDate: "2022-06-30"
    });
    expect(
      tsmQuarterlyExhibit(html.replaceAll("tsm-ex991_18.htm", "../outside.htm"), filing)
    ).toBeUndefined();
    expect(
      tsmQuarterlyExhibit(html.replace("Consolidated", "Unconsolidated"), filing)
    ).toBeUndefined();
    expect(() => tsmQuarterlyExhibit(html + html, filing)).toThrow(/ambiguous/);
  });
  it("selects the two actual quarterly columns, not year-to-date totals or percentages", () => {
    const periods = extractTsmHtml(fixture(), source, filed);
    expect(periods.map((period) => period.id)).toEqual(["2025-Q2", "2026-Q2"]);
    expect(periods[1]).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      sourceUrl: source,
      filedAt: filed,
      reportingCurrency: "TWD",
      derived: true
    });
    expect(periods[1].metrics).toMatchObject({
      revenue: 100_000,
      costOfRevenue: 60_000,
      grossProfit: 40_000,
      operatingExpenses: 20_000,
      operatingIncome: 20_000,
      pretaxIncome: 30_000,
      incomeTax: 5_000,
      netIncome: 25_000,
      researchAndDevelopment: 10_000
    });
    expect(periods[1].metrics.sellingGeneralAndAdministrative).toBeUndefined();
    expect(periods[1].segments?.reduce((sum, segment) => sum + segment.revenue, 0)).toBe(100_000);
    expect(periods[1].segments).toHaveLength(6);
  });

  it("handles the Q1 layout with only two comparative columns", () => {
    const periods = extractTsmHtml(fixture("March 31", false), source, filed);
    expect(periods[1].id).toBe("2026-Q1");
    expect(periods[1].startDate).toBe("2026-01-01");
  });

  it("requires the stated native currency and scale", () => {
    expect(() =>
      extractTsmHtml(
        fixture().replaceAll("Thousands of New Taiwan Dollars", "Millions of US Dollars"),
        source,
        filed
      )
    ).toThrow("native TWD unit");
  });

  it("does not silently accept a missing category or an unreconciled stack", () => {
    expect(() =>
      extractTsmHtml(fixture().replace("Smartphone", "Phone hardware"), source, filed)
    ).toThrow("platform revenue table");
    expect(() =>
      extractTsmHtml(
        fixture().replace(/(<td>Others<\/td><td>\$<\/td><td>)2(<\/td>)/, "$13$2"),
        source,
        filed
      )
    ).toThrow("do not sum to revenue");
  });

  it("rejects duplicated tables, changed numeric structure, and mismatched periods", () => {
    const html = fixture();
    const platform = html.slice(html.lastIndexOf("<table>"));
    expect(() => extractTsmHtml(html + platform, source, filed)).toThrow(
      "expected exactly one platform"
    );
    expect(() =>
      extractTsmHtml(html.replace("<td>100</td>", "<td>not a number</td>"), source, filed)
    ).toThrow("unexpected numeric columns");
    expect(() =>
      extractTsmHtml(
        html.replace(platform, platform.replace("June 30", "September 30")),
        source,
        filed
      )
    ).toThrow("periods differ");
  });

  it("preserves parenthesized negative tax instead of clamping it", () => {
    const html = fixture("March 31", false)
      .replace(/(<td>INCOME TAX EXPENSE[^<]*<\/td><td>\$<\/td><td>)5(<\/td>)/, "$1( 5 )$2")
      .replace(/(<td>NET INCOME<\/td><td>\$<\/td><td>)25(<\/td>)/, "$135$2");
    const period = extractTsmHtml(html, source, filed)[1];
    expect(period.metrics.incomeTax).toBe(-5_000);
    expect(period.metrics.netIncome).toBe(35_000);
  });
});

describe("TSM audited annual HTML history", () => {
  const annual = () => {
    const values = (label: string, value: number, note = "") =>
      row([
        label,
        ...(note ? [note] : []),
        ...[0.8, 0.9, 1, 0.03].map((scale) => (value * scale).toFixed(1))
      ]);
    return `<h1>Taiwan Semiconductor Manufacturing Company Limited and Subsidiaries</h1>
      <h2>CONSOLIDATED STATEMENTS OF PROFIT OR LOSS AND OTHER COMPREHENSIVE INCOME</h2>
      <p>(In Millions of New Taiwan Dollars or U.S. Dollars)</p>
      <table>${row(["Notes", "2016", "2017", "2018"])}${row(["NT$", "NT$", "NT$", "US$"])}
      ${values("NET REVENUE", 200, "6, 25, 38")}${values("COST OF REVENUE", 100, "6, 13, 32")}
      ${values("REALIZED (UNREALIZED) GROSS PROFIT ON SALES TO ASSOCIATES", 10)}
      ${values("GROSS PROFIT", 110)}${values("INCOME FROM OPERATIONS", 60, "43")}
      ${values("INCOME BEFORE INCOME TAX", 70)}${values("INCOME TAX EXPENSE", 10, "6, 30")}
      ${values("NET INCOME", 60)}${values("Research and development", 20)}</table>`;
  };
  it("keeps actual adjustments separate and ignores the convenience USD column", () => {
    const periods = extractTsmAnnualHtml(annual(), source, "2019-04-18");
    expect(periods.map((p) => p.id)).toEqual(["FY2016", "FY2017", "FY2018"]);
    const period = periods[2];
    expect(period.metrics.revenue).toBe(200e6);
    expect(period.metrics.costOfRevenue).toBe(100e6);
    expect(period.metrics.grossProfit).toBe(110e6);
    expect(period.grossProfitAdjustments?.[0]).toMatchObject({ amount: 10e6, sourceUrl: source });
    const converted = convertPeriodToUsd(
      period,
      32,
      "https://www.federalreserve.gov/releases/h10/hist/dat00_ta.htm"
    );
    expect(converted.grossProfitAdjustments?.[0].amount).toBe(10e6 / 32);
    expect(() => validatePeriod(converted)).not.toThrow();
    expect(buildStatementFlow(converted)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("adjustments")
    });
  });
  it("rejects missing adjustments, wrong scales, and ambiguous source tables", () => {
    expect(() =>
      extractTsmAnnualHtml(
        annual().replace(
          "REALIZED (UNREALIZED) GROSS PROFIT ON SALES TO ASSOCIATES",
          "Unknown line"
        ),
        source,
        "2019-04-18"
      )
    ).toThrow(/identities/);
    expect(() =>
      extractTsmAnnualHtml(annual().replace("In Millions", "In Thousands"), source, "2019-04-18")
    ).toThrow(/unit/);
    expect(() => extractTsmAnnualHtml(annual() + annual(), source, "2019-04-18")).toThrow(
      /exactly one/
    );
  });
});
