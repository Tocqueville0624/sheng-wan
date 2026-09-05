import { describe, expect, it } from "vitest";
import { extractTsmHtml } from "../scripts/finance/tsm-html";

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
