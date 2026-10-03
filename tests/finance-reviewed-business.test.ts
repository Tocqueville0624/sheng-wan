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
  it.each(["ABT", "ABTAnnual"] as const)(
    "reads only %s revenue from mixed revenue/cost/profit rows",
    (ticker) => {
      const f = reviewedFixture(ticker);
      const annual = ticker === "ABTAnnual";
      expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual(
        annual
          ? [
              ["Established Pharmaceuticals", 5536e6],
              ["Nutritionals", 8451e6],
              ["Diagnostics", 8937e6],
              ["Medical Devices", 21387e6],
              ["Other", 17e6]
            ]
          : [
              ["Established Pharmaceuticals", 1499e6],
              ["Nutritional Products", 2144e6],
              ["Diagnostic Products", 3092e6],
              ["Medical Devices", 5853e6],
              ["Other", 5e6]
            ]
      );
      expect(f.period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(
        f.period.metrics.revenue
      );
      expect(f.period.businessBreakdownSource?.ruleId).toBe(
        `abt-four-businesses-${annual ? "annual" : "quarterly"}-v1`
      );
      expect(f.period.businessBreakdownSource?.tableIndex).toBe(1);
      expect(f.period.revenueAdjustments).toBeUndefined();
      expect(f.period.segments?.every((s) => s.grossProfit === undefined)).toBe(true);
      for (const source of [
        f.html.replaceAll("Established Pharmaceuticals", "Renamed business"),
        f.html.replaceAll("us-gaap:CorporateNonSegmentMember", "us-gaap:OperatingSegmentsMember"),
        f.html.replaceAll("abt:MedicalDevicesMember", "abt:UnknownBusinessMember")
      ])
        expect(
          enrichReviewedBusinessPeriods(
            source,
            f.identity,
            f.filing,
            [f.basic],
            parseInlineXbrl(source)
          )
        ).toEqual([]);
      const changed = structuredClone(f.period);
      changed.segments![4].revenueSource!.dimensions = {};
      expect(businessPeriod(changed)).toBeUndefined();
    }
  );
  it.each(["MMM", "MMMAnnual"] as const)(
    "preserves %s corporate revenue and after-tax subsidiary income",
    (ticker) => {
      const f = reviewedFixture(ticker);
      const annual = ticker === "MMMAnnual";
      expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual(
        annual
          ? [
              ["Safety and Industrial", 11384e6],
              ["Transportation and Electronics", 8272e6],
              ["Consumer", 4920e6],
              ["Corporate and Other", 372e6]
            ]
          : [
              ["Safety and Industrial", 3091e6],
              ["Transportation and Electronics", 2066e6],
              ["Consumer", 1247e6],
              ["Corporate", 96e6]
            ]
      );
      expect(f.period.metrics.afterTaxSubsidiaryIncome).toBe(annual ? 52e6 : 1e6);
      expect(f.period.metricSources.afterTaxSubsidiaryIncome?.tag).toBe(
        "us-gaap:IncomeLossFromSubsidiariesNetOfTax"
      );
      expect(f.period.metrics.equityMethodIncome).toBeUndefined();
      expect(f.period.revenueAdjustments).toBeUndefined();
      expect(businessPeriod(f.period)).toBeDefined();
      expect(flowPeriod(f.period)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
      const renamed = f.html.replaceAll(
        annual ? "Corporate and Other" : "Corporate",
        "Unreviewed corporate caption"
      );
      expect(
        enrichReviewedBusinessPeriods(
          renamed,
          f.identity,
          f.filing,
          [f.basic],
          parseInlineXbrl(renamed)
        )
      ).toEqual([]);
      const wrongScope = f.html.replaceAll(
        "us-gaap:CorporateNonSegmentMember",
        "us-gaap:OperatingSegmentsMember"
      );
      expect(
        enrichReviewedBusinessPeriods(
          wrongScope,
          f.identity,
          f.filing,
          [f.basic],
          parseInlineXbrl(wrongScope)
        )
      ).toEqual([]);
      const saved = structuredClone(f.period);
      saved.segments!.at(-1)!.revenueSource!.dimensions = {
        "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
      };
      expect(businessPeriod(saved)).toBeUndefined();
    }
  );
  it("uses the reported parent discontinued-operation line after minority attribution without counting it twice", () => {
    const f = reviewedFixture("MMMAnnual");
    const basic = structuredClone(f.basic);
    basic.id = "FY2024";
    basic.fiscalYear = 2024;
    basic.startDate = "2024-01-01";
    basic.endDate = "2024-12-31";
    const revenue = parseInlineXbrl(f.html).facts.find(
      (fact) =>
        fact.tag === "us-gaap:Revenues" &&
        fact.context.start === basic.startDate &&
        fact.context.end === basic.endDate &&
        !Object.keys(fact.context.dimensions).length
    )!;
    basic.metrics = { revenue: revenue.value };
    basic.metricSources = { revenue: f.period.metricSources.revenue };
    const company = { ...f.company, annual: [basic] };
    const [parsed] = readGenericFiling(f.html, f.identity, f.filing, company);
    expect(parsed.metrics).toMatchObject({
      afterTaxSubsidiaryIncome: 9e6,
      noncontrollingInterestIncome: 15e6,
      discontinuedOperationsIncome: 164e6,
      netIncome: 4173e6
    });
    expect(parsed.coverage.sankey).toBe(true);
    const ambiguous = f.html.replaceAll(
      "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity",
      "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax"
    );
    expect(
      readGenericFiling(ambiguous, f.identity, f.filing, company).some((p) => p.coverage.sankey)
    ).toBe(false);
  });
  it("corroborates an alternate standard revenue concept only through a complete exact source statement", () => {
    const f = reviewedFixture("MMM");
    const basic = structuredClone(f.basic);
    basic.metricSources.revenue!.tag =
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
    const company = { ...f.company, quarterly: [basic] };
    const [parsed] = readGenericFiling(f.html, f.identity, f.filing, company);
    expect(parsed.metrics.revenue).toBe(basic.metrics.revenue);
    expect(parsed.metricSources.revenue!.tag).toBe("us-gaap:Revenues");
    expect(parsed.metricSources.revenue!.label).toBe("Net sales");
    expect(parsed.coverage).toEqual({ basics: true, segments: true, sankey: true });
    const mismatched = structuredClone(basic);
    mismatched.metrics.revenue! += 1e6;
    expect(
      readGenericFiling(f.html, f.identity, f.filing, { ...company, quarterly: [mismatched] })
    ).toEqual([]);
    const unsupported = f.html.replaceAll(
      "us-gaap:IncomeLossFromSubsidiariesNetOfTax",
      "mmm:UnreviewedAfterTaxIncome"
    );
    expect(
      readGenericFiling(unsupported, f.identity, f.filing, company).some((p) => p.coverage.sankey)
    ).toBe(false);
  });
  it("includes AMAT's reported Other revenue alongside the two operating segments", () => {
    const f = reviewedFixture("AMAT");
    expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Semiconductor Systems", 7040e6],
      ["Applied Global Services", 1781e6],
      ["Other", 294e6]
    ]);
    expect(f.period.metrics.revenue).toBe(9115e6);
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
    const absent = f.html.replaceAll('contextRef="c-275"', 'contextRef="missing"');
    expect(
      enrichReviewedBusinessPeriods(
        absent,
        f.identity,
        f.filing,
        [f.basic],
        parseInlineXbrl(absent)
      )
    ).toEqual([]);
  });
  it("retains the annual AMAT Corporate and Other classification from its own source", () => {
    const f = reviewedFixture("AMATAnnual");
    expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Semiconductor Systems", 20798e6],
      ["Applied Global Services", 6385e6],
      ["Corporate and Other", 1185e6]
    ]);
    expect(f.period.metrics.revenue).toBe(28368e6);
    expect(f.period.businessBreakdownSource?.ruleId).toBe(
      "amat-semiconductor-services-corporate-v1"
    );
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
  });
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
