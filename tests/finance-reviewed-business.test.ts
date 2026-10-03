import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichReviewedBusinessPeriods } from "../scripts/finance/reviewed-business";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { businessPeriod } from "../scripts/finance/v2-model";
import type { CatalogCompany, PeriodV2 } from "../src/features/finance/v2-types";
import type { SecFiling } from "../scripts/finance/sec-shared";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { readGenericFiling, genericFilingTodo } from "../scripts/finance/generic-import";

const html = readFileSync(
  new URL("./fixtures/finance/wmt-2026-business-statement.html", import.meta.url),
  "utf8"
);
const identity: CatalogCompany = {
  ticker: "WMT",
  name: "Walmart",
  cik: "0000104169",
  sector: "Consumer Staples",
  universe: "sp500"
};
const filing: SecFiling = {
  accession: "0000104169-26-000154",
  filedAt: "2026-08-28",
  reportDate: "2026-07-31",
  form: "10-Q",
  primaryDocument: "wmt-20260731.htm",
  directoryUrl: "https://www.sec.gov/Archives/edgar/data/104169/000010416926000154/",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/104169/000010416926000154/wmt-20260731.htm"
};
const basic: PeriodV2 = {
  id: "2027-Q2",
  label: "Q2 FY2027",
  kind: "quarterly",
  fiscalYear: 2027,
  fiscalQuarter: 2,
  startDate: "2026-05-01",
  endDate: "2026-07-31",
  filedAt: filing.filedAt,
  accession: filing.accession,
  sourceUrl: filing.sourceUrl,
  reportingCurrency: "USD",
  displayCurrency: "USD",
  derived: false,
  metrics: { revenue: 187937e6 },
  metricSources: {
    revenue: { label: "Total revenues", tag: "us-gaap:Revenues", ...filing, method: "reported" }
  },
  coverage: { basics: true, segments: false, sankey: false }
};
const enrich = (source = html, period = basic) =>
  enrichReviewedBusinessPeriods(source, identity, filing, [period], parseInlineXbrl(source));

describe("reviewed vertical business tables", () => {
  it("reconciles JNJ's two source columns to its separately reported consolidated revenue", () => {
    const f = reviewedFixture("JNJ");
    expect(f.period.segments?.map((s) => [s.label, s.revenue, s.grossProfit])).toEqual([
      ["Innovative Medicine", 16384e6, 12088e6],
      ["MedTech", 8926e6, 5189e6]
    ]);
    expect(f.period.metrics.revenue).toBe(25310e6);
    expect(f.period.coverage.sankey).toBe(true);
    expect(f.period.businessBreakdownSource?.totalTableIndex).toBe(0);
    expect(f.period.businessBreakdownSource?.tableIndex).toBe(1);
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
    expect(
      enrichReviewedBusinessPeriods(
        f.html.replaceAll("Innovative Medicine", "Renamed business"),
        f.identity,
        f.filing,
        [f.basic],
        parseInlineXbrl(f.html.replaceAll("Innovative Medicine", "Renamed business"))
      )
    ).toEqual([]);
  });

  it("reads the full source statement when standard Company Facts omitted revenue", () => {
    const f = reviewedFixture("WMT");
    const partial = structuredClone(f.basic);
    delete partial.metrics.revenue;
    delete partial.metricSources.revenue;
    const baseline = { ...f.company, quarterly: [partial] };
    expect(genericFilingTodo(baseline, [], [f.filing])).toEqual([f.filing]);
    const [p] = readGenericFiling(f.html, f.identity, f.filing, baseline);
    expect(p.metrics.revenue).toBe(187937e6);
    expect(p.coverage.sankey).toBe(true);
    expect(p.coverage.segments).toBe(true);
    expect(p.metricSources.revenue?.method).toBe("reported");
    expect(flowPeriod(p)).toBeDefined();
  });
  it("preserves Walmart's complete reported segment revenues and corporate membership income", () => {
    const before = structuredClone(basic);
    const [p] = enrich();
    expect(p.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Walmart U.S.", 125939e6],
      ["Walmart International", 35624e6],
      ["Sam's Club U.S.", 26367e6],
      ["Corporate and support", 7e6]
    ]);
    expect(p.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(p.metrics.revenue);
    expect(p.segments?.map((s) => s.grossProfit)).toEqual([37588e6, 7965e6, 3573e6, undefined]);
    expect(p.revenueAdjustments).toBeUndefined();
    expect(p.businessBreakdownSource?.ruleId).toBe("wmt-operating-segments-v1");
    expect(businessPeriod(p)).toBeDefined();
    expect(basic).toEqual(before);
    expect(enrich(html, p)).toEqual([]);
  });

  it("does not substitute net sales for full revenues or fill an unreported corporate remainder", () => {
    expect(enrich(html, { ...basic, metrics: { revenue: 186100e6 } })).toEqual([]);
    const absentCorporate = html.replace(
      /<ix:nonFraction\b(?=[^>]*contextRef="c-147")(?=[^>]*name="us-gaap:OtherIncome")[^>]*>/g,
      (opening) => opening.replace('name="us-gaap:OtherIncome"', 'name="test:Missing"')
    );
    expect(absentCorporate).not.toBe(html);
    expect(enrich(absentCorporate)).toEqual([]);
    expect(enrich(html.replace(">125,939<", ">125,949<"))).toEqual([]);
  });

  it("rejects changed labels, foreign classifications, dates and duplicate conflicts", () => {
    for (const source of [
      html.replaceAll("Walmart International", "New business"),
      html.replaceAll("wmt:WalmartInternationalMember", "wmt:NewMember"),
      html.replaceAll('dimension="srt:ConsolidationItemsAxis"', 'dimension="srt:GeographicalAxis"'),
      html.replaceAll("2026-05-01", "2026-04-01")
    ])
      expect(enrich(source)).toEqual([]);
    const conflict =
      '<ix:nonFraction name="us-gaap:Revenues" contextRef="c-135" unitRef="usd" decimals="-6" scale="6">125,940</ix:nonFraction>';
    expect(enrich(html + conflict)).toEqual([]);
  });

  it("revalidates reviewed rules and every branch on reads", () => {
    const [p] = enrich();
    for (const change of [
      (next: PeriodV2) => {
        next.businessBreakdownSource!.ruleId = "unreviewed";
      },
      (next: PeriodV2) => {
        next.segments![0].revenueSource!.dimensions = {};
      },
      (next: PeriodV2) => {
        next.segments![0].revenueSource!.rowLabel = "Net sales";
      },
      (next: PeriodV2) => {
        next.segments![3].revenueSource!.tag = "us-gaap:Revenues";
      },
      (next: PeriodV2) => {
        next.segments!.pop();
      }
    ]) {
      const next = structuredClone(p);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });
});
