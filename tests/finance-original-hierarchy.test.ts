import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  originalHierarchyCases,
  originalHierarchyFixture
} from "./fixtures/finance/original-hierarchy-fixture";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { originalHierarchyProblem } from "../src/features/finance/original-hierarchy-revenue";
import { originalExactMillionDollars } from "../src/features/finance/original-revenue-rows";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("Original Avery Dennison and Baxter business hierarchies", () => {
  for (const [ticker, id] of originalHierarchyCases) {
    it(`${ticker} ${id} binds complete original business and primary cells without replacing financial facts`, () => {
      const s = originalHierarchyFixture(ticker, id),
        p = s.period;
      expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
      expect(p?.coverage.segments).toBe(true);
      expect(p.metrics).toEqual(s.retained.metrics);
      expect(p.metricSources).toEqual(s.retained.metricSources);
      expect(p.sourceUrl).toBe(s.retained.sourceUrl);
      expect(p.startDate).toBe(s.retained.startDate);
      expect(p.endDate).toBe(s.retained.endDate);
      expect(p.segments).toEqual(s.source.expectedBusiness);
      expect(originalHierarchyProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(p.segments!.every((s) => s.grossProfit === undefined)).toBe(true);
      validateV2(companyFromFilingPeriods(s.identity, [p]));
      const flow = flowPeriod(p);
      if (flow) {
        const result = buildStatementFlow(flow);
        expect(result.ok).toBe(true);
        if (!result.ok) throw Error(result.reason);
        for (const s of p.segments!)
          expect(
            result.graph.links
              .filter((l) => l.source === `segment-${s.id}`)
              .reduce((n, l) => n + l.value, 0)
          ).toBe(s.revenue);
      }
    });
    it(`${ticker} ${id} reads the filing's current period with no saved company or Company Facts`, () => {
      const s = originalHierarchyFixture(ticker, id, true);
      expect(s.period?.coverage.segments).toBe(true);
      expect(s.period.endDate).toBe(s.source.filing.reportDate);
      expect(originalHierarchyProblem(s.period)).toBeUndefined();
      validateV2(companyFromFilingPeriods(s.identity, s.periods));
    });
  }
  it("preserves Avery's exact original decimal dollars and the 368-day fiscal transition", () => {
    const p = originalHierarchyFixture("AVY", "FY2025").period;
    expect(p.startDate).toBe("2024-12-29");
    expect(p.endDate).toBe("2025-12-31");
    expect(p.segments!.map((s) => s.label)).toEqual([
      "Labels, graphics and reflectives",
      "Performance materials",
      "Other",
      "Apparel and other",
      "Identification Solutions and Vestcom"
    ]);
    const old = originalHierarchyFixture("AVY", "FY2021").period;
    const closing = old
      .businessBreakdownSource!.originalBusinessHierarchy!.rows.filter((r) =>
        r.cells.some((c) => c.fact)
      )
      .at(-1)!;
    const f = closing.cells.find((c) => c.fact?.startDate === old.startDate)!;
    expect(f.fact!.value).toBe(8408299999.999999);
    expect(originalExactMillionDollars(f)).toBe(8408300000n);
    expect(old.metrics.revenue).toBe(8408300000);
  });
  it("keeps Baxter's actual corporate Other and its 2026 product reorganization without parent duplication", () => {
    const p = originalHierarchyFixture("BAX", "2026-Q2").period;
    expect(p.segments!.map((s) => [s.label, s.revenue])).toEqual([
      ["Infusion Therapies & Platforms", 1745000000],
      ["Advanced Surgery", 331000000],
      ["Care & Connectivity Solutions", 502000000],
      ["Front Line Care", 299000000],
      ["Other", 83000000]
    ]);
    expect(p.segments!.reduce((n, s) => n + s.revenue, 0)).toBe(2960000000);
    expect(p.segmentBasis).toContain("not counted twice");
  });
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "missing original physical row",
      (p) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.rows.splice(5, 1);
      }
    ],
    [
      "unknown geographic member",
      (p) => {
        const c = p
          .businessBreakdownSource!.originalBusinessHierarchy!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact?.dimensions["srt:StatementGeographicalAxis"]);
        c!.fact!.dimensions["srt:StatementGeographicalAxis"] = "country:GB";
      }
    ],
    [
      "changed original primary amount",
      (p) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.primary.revenue.cells.find(
          (c) => c.fact
        )!.fact!.value += 1000000;
      }
    ],
    [
      "changed original precision",
      (p) => {
        p
          .businessBreakdownSource!.originalBusinessHierarchy!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact)!.fact!.declarations[0].decimals = "-3";
      }
    ],
    [
      "changed comparative date",
      (p) => {
        p
          .businessBreakdownSource!.originalBusinessHierarchy!.rows.flatMap((r) => r.cells)
          .filter((c) => c.fact)
          .at(-1)!.fact!.startDate = "2025-01-01";
      }
    ],
    [
      "unreported positive business",
      (p) => {
        p.segments!.push({ ...p.segments![0], id: "fake" });
      }
    ],
    [
      "negative business",
      (p) => {
        p.segments![0].revenue = -1;
      }
    ],
    [
      "retained amount changed",
      (p) => {
        p.metrics.revenue! += 1;
      }
    ],
    [
      "company issuer changed",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("/10456/", "/8818/");
      }
    ],
    [
      "source proof hidden under generic method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "unknown business caption",
      (p) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.rows.find((r) =>
          r.cells.some((c) => c.fact)
        )!.cells[0].label = "New business";
      }
    ],
    [
      "country column becomes worldwide",
      (p) => {
        const c = p
          .businessBreakdownSource!.originalBusinessHierarchy!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact?.dimensions["srt:StatementGeographicalAxis"]);
        delete c!.fact!.dimensions["srt:StatementGeographicalAxis"];
      }
    ],
    [
      "unreviewed statement fiscal year",
      (p) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.originalFiscalYear = 2022;
      }
    ],
    [
      "quarter statement relabeled annual",
      (p) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.form = "10-K";
      }
    ]
  ];
  for (const [name, change] of mutations)
    it(`rejects ${name} on stored reads`, () => {
      const p = structuredClone(originalHierarchyFixture("BAX", "2026-Q2").period);
      change(p);
      expect(businessPeriod(p)).toBeUndefined();
    });
  it("rejects an altered Materials product subtotal, absent calendar note, or fabricated annual mix in a quarter", () => {
    const p = originalHierarchyFixture("AVY", "FY2025").period;
    for (const change of [
      (p: PeriodV2) => {
        p
          .businessBreakdownSource!.originalBusinessHierarchy!.materialProducts!.rows.flatMap(
            (r) => r.cells
          )
          .find((c) => c.fact)!.fact!.value += 100000;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.fiscalCalendar = "";
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.originalBusinessHierarchy!.rows[1].cells.find(
          (c) => c.label === "2025 (2)"
        )!.label = "2024";
      }
    ]) {
      const changed = structuredClone(p);
      change(changed);
      expect(businessPeriod(changed)).toBeUndefined();
    }
    const quarter = structuredClone(originalHierarchyFixture("AVY", "2026-Q2").period);
    quarter.businessBreakdownSource!.originalBusinessHierarchy!.materialProducts =
      p.businessBreakdownSource!.originalBusinessHierarchy!.materialProducts;
    expect(businessPeriod(quarter)).toBeUndefined();
  });
  it("unknown original Baxter product captions do not fall back to a generic business subset", () => {
    const s = originalHierarchyFixture("BAX", "2026-Q2");
    const html = s.html.replaceAll("Infusion Therapies &amp; Platforms", "Unknown revenue");
    const next = readGenericFiling(
      html,
      s.identity,
      s.source.filing,
      companyFromFilingPeriods(s.identity, [s.retained]),
      []
    );
    expect(next.every((p) => !p.coverage.segments)).toBe(true);
  });
});
