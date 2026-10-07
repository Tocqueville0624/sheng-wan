import { describe, expect, it } from "vitest";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { enrichAmetekBusinessPeriods } from "../scripts/finance/ametek-business-v2";
import { ametekRevenueProblem } from "../src/features/finance/ametek-revenue";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import type { PeriodV2 } from "../src/features/finance/v2-types";

// Independently transcribed original closing EIG and EMG rows, USD thousands.
const cases = [
  ["AMEBusinessFY2017", [2690554, 1609616]],
  ["AMEBusinessFY2021", [3763758, 1782756]],
  ["AMEBusinessFY2025", [4919100, 2482016]],
  ["AMEBusiness2020Q1", [774225, 427993]],
  ["AMEBusiness2023Q2", [1134646, 511465]],
  ["AMEBusiness2026Q1", [1264536, 663901]],
  ["AMEBusiness2026Q2", [1321153, 723244]]
] as const;
describe("AMETEK original complete EIG/EMG closing sales", () => {
  it.each(cases)("preserves %s original businesses and financial statement", (key, amounts) => {
    const f = reviewedFixture(key),
      p = f.period;
    expect(p.segments?.map((s) => s.label)).toEqual([
      "Electronic Instruments",
      "Electromechanical"
    ]);
    expect(p.segments?.map((s) => s.revenue)).toEqual(amounts.map((n) => n * 1000));
    expect(p.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(p.metrics.revenue);
    expect(p.businessBreakdownSource?.method).toBe("reviewed-ametek-revenue");
    expect(p.revenueAdjustments).toBeUndefined();
    expect(
      p.segments?.every(
        (s) =>
          s.grossProfit === undefined &&
          s.grossProfitSource === undefined &&
          !s.revenueSource?.calculation
      )
    ).toBe(true);
    expect(ametekRevenueProblem(p)).toBeUndefined();
    expect(businessPeriod(p)).toBeDefined();
    expect(flowPeriod(p)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
    const original = {
      ...p,
      segments: undefined,
      businessBreakdownSource: undefined,
      segmentSourceUrl: undefined,
      segmentBasis: undefined,
      coverage: { ...p.coverage, segments: false }
    };
    const next = enrichAmetekBusinessPeriods(
      f.html,
      f.identity,
      f.filing,
      [original],
      parseInlineXbrl(f.html)
    )[0]!;
    expect(next.metrics).toEqual(f.period.metrics);
    expect(next.metricSources).toEqual(original.metricSources);
    expect(next.segments).toEqual(p.segments);
  });
  it.each(["AMEBusinessFY2025", "AMEBusiness2026Q1", "AMEBusiness2026Q2"] as const)(
    "supports %s first import without Company Facts",
    (key) => {
      const f = reviewedFixture(key);
      const p = readGenericFiling(f.html, f.identity, f.filing, undefined).find(
        (p) => p.id === f.period.id
      )!;
      expect(p.coverage.segments).toBe(true);
      expect(p.segments).toEqual(f.period.segments);
      expect(p.metrics.revenue).toBe(f.period.metrics.revenue);
      expect(flowPeriod(p)).toBeDefined();
    }
  );
  it("retains the actual annual tax QNames without aliasing them", () => {
    const prior = reviewedFixture("AMEBusinessFY2021").period,
      current = reviewedFixture("AMEBusinessFY2025").period;
    expect(
      prior.segments?.every(
        (s) =>
          s.revenueSource?.tag === "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax"
      )
    ).toBe(true);
    expect(
      current.segments?.every(
        (s) =>
          s.revenueSource?.tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
      )
    ).toBe(true);
  });
  it("preserves cumulative cells without adding them to the original quarter", () => {
    const p = reviewedFixture("AMEBusiness2026Q2").period;
    const facts = p.businessBreakdownSource!.ametekRevenue!.revenue.cells.flatMap((c) =>
      c.fact ? [c.fact] : []
    );
    expect(facts.filter((f) => f.startDate === "2026-01-01").map((f) => f.value)).toEqual([
      2585689000, 1387145000, 3972834000
    ]);
    expect(p.metrics.revenue).toBe(2044397000);
    expect(p.segments?.map((s) => s.revenue)).toEqual([1321153000, 723244000]);
  });
  it.each([
    [
      "changed displayed amount",
      (p: PeriodV2) => {
        const c = p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find((c) => c.fact)!;
        c.label = "999,999";
      }
    ],
    [
      "changed amount and branch",
      (p: PeriodV2) => {
        p.segments![0].revenue += 1000;
      }
    ],
    [
      "changed revenue scale",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find(
          (c) => c.fact
        )!.fact!.declarations[0].scale = 6;
      }
    ],
    [
      "changed original scale",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find(
          (c) => c.fact
        )!.fact!.declarations[0].originalScale = "6";
      }
    ],
    [
      "changed precision",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find(
          (c) => c.fact
        )!.fact!.decimals = -6;
      }
    ],
    [
      "changed currency unit",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.units = [];
      }
    ],
    [
      "changed issuer",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find((c) => c.fact)!.fact!.cik =
          "0000915913";
      }
    ],
    [
      "changed temporal caption",
      (p: PeriodV2) => {
        const r = p
          .businessBreakdownSource!.ametekRevenue!.headerRows.flatMap((r) => r.cells)
          .find((c) => /^Three months/i.test(c.label))!;
        r.label = r.label.replace(/Three/i, "Six");
      }
    ],
    [
      "changed complete heading",
      (p: PeriodV2) => {
        p
          .businessBreakdownSource!.ametekRevenue!.headerRows.flatMap((r) => r.cells)
          .find((c) => c.label === "EMG")!.label = "Unknown business";
      }
    ],
    [
      "unaccounted closing row label",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find(
          (c) => !c.fact && !c.label
        )!.label = "Unreviewed business amount";
      }
    ],
    [
      "changed physical coordinate",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find((c) => c.fact)!.columnIndex +=
          1;
      }
    ],
    [
      "changed business scope",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find(
          (c) => c.fact
        )!.fact!.dimensions["srt:StatementGeographicalAxis"] = "country:US";
      }
    ],
    [
      "changed independent total",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.primary.revenue.cells.find(
          (c) => c.fact
        )!.fact!.value += 1000;
      }
    ],
    [
      "changed primary title",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.primary.title = "Affiliate income statement";
      }
    ],
    [
      "invented business gross profit",
      (p: PeriodV2) => {
        p.segments![0].grossProfit = 1;
      }
    ],
    [
      "changed proof method",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.method = "statement-revenue-matrix";
      }
    ],
    [
      "changed tax QName",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.find((c) => c.fact)!.fact!.tag =
          "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax";
      }
    ],
    [
      "missing business column",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.revenue.cells.splice(2, 1);
      }
    ],
    [
      "unapproved source owner",
      (p: PeriodV2) => {
        p.sourceUrl = p.sourceUrl.replace("/1037868/", "/915913/");
      }
    ],
    [
      "changed fiscal metadata",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.ametekRevenue!.originalFiscalYear -= 1;
      }
    ]
  ] as const)("rejects %s in saved or exported proof", (_name, alter) => {
    const p = structuredClone(reviewedFixture("AMEBusiness2026Q2").period);
    alter(p);
    expect(businessPeriod(p)).toBeUndefined();
  });
  it("withholds a renamed business without a generic fallback", () => {
    const f = reviewedFixture("AMEBusinessFY2025");
    const html = f.html.replaceAll("EIG", "Unknown business");
    const p = readGenericFiling(html, f.identity, f.filing, {
      ...f.company,
      annual: [f.basic]
    }).find((p) => p.id === f.period.id);
    expect(p?.coverage.segments ?? false).toBe(false);
  });
  it("rejects cumulative-only captions instead of supplying first-quarter revenue", () => {
    const f = reviewedFixture("AMEBusiness2026Q1");
    const html = f.html
      .replaceAll("Three months ended", "Six months ended")
      .replaceAll("Three Months Ended", "Six Months Ended");
    expect(
      enrichAmetekBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html))
    ).toEqual([]);
  });
});
