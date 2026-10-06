import { describe, expect, it } from "vitest";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { enrichAlbemarleBusinessPeriods } from "../scripts/finance/albemarle-business-v2";
import { albemarleRevenueProblem } from "../src/features/finance/albemarle-revenue";
import {
  businessPeriod,
  flowPeriod,
  mergeV2,
  normalizeBasicCompany,
  validateV2
} from "../scripts/finance/v2-model";
import { reviewedFiscalYear } from "../scripts/finance/fiscal-label";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import type { PeriodV2 } from "../src/features/finance/v2-types";

// Independently transcribed original table amounts, in USD thousands. Both
// original and restated classifications remain tied to their actual filing.
const cases = [
  [
    "ALBBusinessFY2021",
    ["Energy Storage", "Specialties", "Ketjen", "All Other"],
    [1067430, 1424197, 761235, 75095]
  ],
  [
    "ALBBusinessFY2017",
    ["Lithium", "Bromine Specialties", "Catalysts", "All Other", "Corporate"],
    [1018885, 855143, 1067572, 128914, 1462]
  ],
  [
    "ALBBusinessFY2018",
    ["Lithium", "Bromine Specialties", "Catalysts", "All Other", "Corporate"],
    [1228171, 917880, 1101554, 127186, 159]
  ],
  [
    "ALBBusinessFY2019",
    ["Lithium", "Bromine", "Catalysts", "All Other"],
    [1358170, 1004216, 1061817, 165224]
  ],
  ["ALBBusinessFY2022", ["Energy Storage", "Specialties", "Ketjen"], [4660945, 1759587, 899572]],
  ["ALBBusinessFY2025", ["Energy Storage", "Specialties", "Ketjen"], [2710035, 1366435, 1066263]],
  [
    "ALBBusiness2020Q2",
    ["Lithium", "Bromine Specialties", "Catalysts", "All Other"],
    [283722, 232779, 197053, 50495]
  ],
  ["ALBBusiness2022Q1", ["Energy Storage", "Specialties", "Ketjen"], [463704, 446147, 217877]],
  [
    "ALBBusiness2025Q1",
    ["Energy Storage", "Specialties", "Corporate and all other"],
    [524565, 321014, 231302]
  ],
  [
    "ALBBusiness2026Q2",
    ["Energy Storage", "Specialties", "Corporate and all other"],
    [1276684, 423484, 43145]
  ],
  ["ALBBusiness2025Q3", ["Energy Storage", "Specialties", "Ketjen"], [708755, 344960, 254114]],
  [
    "ALBBusinessFY2021Original2022",
    ["Lithium", "Bromine", "Catalysts", "All Other"],
    [1363284, 1128343, 761235, 75095]
  ],
  [
    "ALBBusinessFY2022Original2022",
    ["Lithium", "Bromine", "Catalysts", "All Other"],
    [5008850, 1411682, 899572, 0]
  ]
] as const;
describe("Albemarle complete original business revenue", () => {
  it.each(cases)(
    "preserves %s original classification and exact consolidated revenue",
    (key, labels, amounts) => {
      const f = reviewedFixture(key),
        p = f.period;
      expect(p.segments?.map((s) => s.label)).toEqual(labels);
      expect(p.segments?.map((s) => s.revenue)).toEqual(amounts.map((x) => x * 1000));
      expect(p.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(p.metrics.revenue);
      expect(p.revenueAdjustments).toBeUndefined();
      expect(p.businessBreakdownSource?.method).toBe("reviewed-albemarle-revenue");
      expect(albemarleRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
      expect(
        p.segments?.every(
          (s) =>
            s.grossProfit === undefined &&
            s.grossProfitSource === undefined &&
            !s.revenueSource?.calculation
        )
      ).toBe(true);
      const original = {
        ...p,
        segments: undefined,
        businessBreakdownSource: undefined,
        segmentSourceUrl: undefined,
        segmentBasis: undefined,
        coverage: { ...p.coverage, segments: false }
      };
      const reread = enrichAlbemarleBusinessPeriods(
        f.html,
        f.identity,
        f.filing,
        [original],
        parseInlineXbrl(f.html)
      )[0]!;
      expect(reread.metrics).toEqual(original.metrics);
      expect(reread.metricSources).toEqual(original.metricSources);
      expect(reread.segments).toEqual(p.segments);
      if (p.coverage.sankey) expect(flowPeriod(reread)).toBeDefined();
    }
  );
  it.each(["ALBBusinessFY2025", "ALBBusiness2026Q2", "ALBBusinessFY2022Original2022"] as const)(
    "supports %s first import without Company Facts",
    (key) => {
      const f = reviewedFixture(key);
      const p = readGenericFiling(f.html, f.identity, f.filing, undefined).find(
        (p) => p.id === f.period.id
      )!;
      expect(p.coverage.segments).toBe(true);
      expect(p.segments).toEqual(f.period.segments);
      expect(p.metrics.revenue).toBe(f.period.metrics.revenue);
      expect(p.fiscalYear).toBe(f.period.fiscalYear);
    }
  );
  it("keeps the reported corporate branch and corroborates, without adding, the operating-segment subtotal", () => {
    const p = reviewedFixture("ALBBusiness2026Q2").period,
      proof = p.businessBreakdownSource!.albemarleRevenue!;
    const subtotal = proof.rows.find((r) => r.cells[0]?.label === "Total segment net sales")!;
    expect(
      subtotal.cells.find((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)
        ?.fact?.value
    ).toBe(1700168000);
    expect(p.segments!.at(-1)!.revenue).toBe(43145000);
    expect(p.metrics.revenue).toBe(1743313000);
    expect(p.segments!.at(-1)!.revenueSource!.dimensions).toEqual({
      "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
    });
  });
  it("retains original zero transforms and the original untransformed 2018 corporate amount", () => {
    const p = reviewedFixture("ALBBusinessFY2018").period;
    const corporate = p.businessBreakdownSource!.albemarleRevenue!.rows.find(
      (r) => r.cells[0]?.label === "Corporate"
    )!;
    expect(
      corporate.cells.filter((c) => c.fact).map((c) => c.fact!.declarations[0].format)
    ).toEqual(["ixt:zerodash", "ixt:zerodash", ""]);
    expect(p.segments!.at(-1)!.revenue).toBe(159000);
  });
  it("corrects the immutable 2022 metadata conflict without changing source values, and retains actual 2021 history", () => {
    const f = reviewedFixture("ALBBusinessFY2022Original2022");
    expect(parseInlineXbrl(f.html).fiscalYear).toBe(2021);
    expect(f.period.fiscalYear).toBe(2022);
    expect(reviewedFiscalYear(f.identity, f.filing, 2021)).toBe(2022);
    expect(reviewedFiscalYear({ ...f.identity, cik: "0001086222" }, f.filing, 2021)).toBe(2021);
    expect(
      reviewedFiscalYear(f.identity, { ...f.filing, accession: "0000915913-23-000040" }, 2021)
    ).toBe(2021);
    const old = {
      ...structuredClone(f.company),
      annual: [{ ...f.period, id: "FY2021", label: "FY 2021", fiscalYear: 2021 }]
    };
    const normalized = normalizeBasicCompany(old);
    expect(normalized.annual[0].id).toBe("FY2022");
    expect(normalized.annual[0].metrics).toEqual(old.annual[0].metrics);
    expect(normalized.annual[0].metricSources).toEqual(old.annual[0].metricSources);
    expect(normalizeBasicCompany(normalized)).toBe(normalized);
    const earlier = reviewedFixture("ALBBusinessFY2021Original2022").period;
    const merged = mergeV2(normalized, { ...f.company, annual: [earlier, f.period] });
    expect(merged.annual.map((p) => [p.id, p.endDate])).toEqual([
      ["FY2021", "2021-12-31"],
      ["FY2022", "2022-12-31"]
    ]);
  });
  it.each([
    [
      "business amount",
      (p: PeriodV2) => {
        p.segments![0].revenue += 1000;
      }
    ],
    [
      "business caption",
      (p: PeriodV2) => {
        p.segments![0].label = "Unknown business";
      }
    ],
    [
      "corporate scope",
      (p: PeriodV2) => {
        p.segments!.at(-1)!.revenueSource!.dimensions = {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        };
      }
    ],
    [
      "source year",
      (p: PeriodV2) => {
        p
          .businessBreakdownSource!.albemarleRevenue!.headerRows.find((r) =>
            r.cells.some((c) => c.label === "2026")
          )!
          .cells.find((c) => c.label === "2026")!.label = "2027";
      }
    ],
    [
      "subtotal",
      (p: PeriodV2) => {
        p
          .businessBreakdownSource!.albemarleRevenue!.rows.find(
            (r) => r.cells[0]?.label === "Total segment net sales"
          )!
          .cells.find(
            (c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate
          )!.fact!.value += 1000;
      }
    ],
    [
      "foreign declaration",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.albemarleRevenue!.rows[0].cells.find((c) => c.fact)!.fact!.cik =
          "1086222";
      }
    ],
    [
      "invented business gross profit",
      (p: PeriodV2) => {
        p.segments![0].grossProfit = 1;
      }
    ],
    [
      "missing corporate row",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.albemarleRevenue!.rows.splice(-2, 1);
      }
    ],
    [
      "changed method",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ]
  ] as const)("rejects altered %s in stored or exported proof", (_name, alter) => {
    const p = structuredClone(reviewedFixture("ALBBusiness2026Q2").period);
    alter(p);
    expect(businessPeriod(p)).toBeUndefined();
  });
  it("withholds unknown source classifications without falling back to a generic revenue partition", () => {
    const f = reviewedFixture("ALBBusinessFY2025");
    const html = f.html.replaceAll("Energy Storage", "Unknown business");
    const p = readGenericFiling(html, f.identity, f.filing, {
      ...f.company,
      annual: [f.basic]
    }).find((p) => p.id === f.period.id);
    expect(p?.coverage.segments ?? false).toBe(false);
  });
  it("rejects a cumulative-only caption instead of interpreting it as a first-quarter header", () => {
    const f = reviewedFixture("ALBBusiness2022Q1"),
      html = f.html.replaceAll("Three Months Ended", "Six Months Ended");
    expect(
      enrichAlbemarleBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html))
    ).toEqual([]);
  });
});
