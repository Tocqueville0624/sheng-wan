import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { churchDwightOriginalFixture } from "./fixtures/finance/church-dwight-original-fixture";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { churchDwightRevenueProblem } from "../src/features/finance/church-dwight-revenue";
import {
  originalMillionDollarRows,
  originalExactMillionDollars
} from "../src/features/finance/original-revenue-rows";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2, CatalogCompany } from "../src/features/finance/v2-types";

describe("Original Church & Dwight product revenue hierarchy", () => {
  it("retains historical floating-point facts and actual negative income tax across all comparative columns", () => {
    const s = churchDwightOriginalFixture("historical"),
      p = s.period;
    expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
    expect(p.metrics).toEqual(s.retained.metrics);
    expect(p.metricSources).toEqual(s.retained.metricSources);
    expect(p.metrics.incomeTax).toBe(-50700000);
    expect(p.segments!.map((s) => s.revenue)).toEqual([
      1640000000, 1214900000, 621100000, 300200000
    ]);
    expect(churchDwightRevenueProblem(p)).toBeUndefined();
    const proof = p.businessBreakdownSource!.churchDwightRevenue!;
    const original = proof.rows.at(-1)!.cells.filter((c) => c.fact)[1];
    expect(original.fact!.value).toBe(4145899999.9999995);
    expect(originalExactMillionDollars(original)).toBe(4145900000n);
    expect(businessPeriod(p)).toBeDefined();
    expect(flowPeriod(p)).toBeDefined();
    validateV2(companyFromFilingPeriods(s.identity, [p]));
  });
  for (const kind of ["annual", "quarterly"] as const) {
    it(`pins unchanged ${kind} original source and preserves retained financial facts`, () => {
      const s = churchDwightOriginalFixture(kind),
        p = s.period;
      expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
      expect(p).toBeDefined();
      expect(p.metrics).toEqual(s.retained.metrics);
      expect(p.metricSources).toEqual(s.retained.metricSources);
      expect(churchDwightRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(flowPeriod(p)).toBeDefined();
      expect(p.segments!.map((s) => s.label)).toEqual([
        "Household Products",
        "Personal Care Products",
        "Total Consumer International",
        "Total SPD"
      ]);
      expect(p.segments!.map((s) => s.revenue)).toEqual(
        kind === "annual"
          ? [2556900000, 2217900000, 1129400000, 299000000]
          : [662000000, 493800000, 297500000, 76700000]
      );
      expect(p.segments!.reduce((n, s) => n + s.revenue, 0)).toBe(p.metrics.revenue);
      expect(
        p.segments!.every((s) => s.grossProfit === undefined && s.revenueSource?.decimals === -5)
      ).toBe(true);
      const proof = p.businessBreakdownSource!.churchDwightRevenue!;
      expect(proof.rows).toHaveLength(6);
      expect(proof.rows[2].cells.filter((c) => c.fact)).toHaveLength(kind === "annual" ? 3 : 4);
      expect(
        proof.rows
          .flatMap((r) => r.cells)
          .filter((c) => c.fact)
          .every((c) =>
            c.fact!.declarations.every((d) => d.originalScale === "6" && d.decimals === "-5")
          )
      ).toBe(true);
      // The old whole-million contract remains strict; the finite new reader
      // preserves, rather than relabels, the source's tenth-million precision.
      expect(() =>
        originalMillionDollarRows([...proof.headerRows, ...proof.rows], proof.units, s.identity.cik)
      ).toThrow();
      expect(originalExactMillionDollars(proof.rows[0].cells.find((c) => c.fact)!)).toBe(
        kind === "annual" ? 2556900000n : 662000000n
      );
      const graph = buildStatementFlow(flowPeriod(p)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw Error(graph.reason);
      for (const segment of p.segments!)
        expect(
          graph.graph.links
            .filter((l) => l.source === `segment-${segment.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(segment.revenue);
      validateV2(companyFromFilingPeriods(s.identity, [p]));
    });
    it(`recovers the current ${kind} source without saved data or Company Facts`, () => {
      const s = churchDwightOriginalFixture(kind, true);
      expect(s.period?.coverage.segments).toBe(true);
      expect(churchDwightRevenueProblem(s.period)).toBeUndefined();
      validateV2(companyFromFilingPeriods(s.identity, s.periods));
    });
  }
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "visible product label",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows[0].cells[0].label =
          "Geographic revenue";
      }
    ],
    [
      "comparative product amount",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows[0].cells.filter(
          (c) => c.fact
        )[1].fact!.value += 100000;
      }
    ],
    [
      "declared precision",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows[0].cells.find(
          (c) => c.fact
        )!.fact!.declarations[0].decimals = "-6";
      }
    ],
    [
      "product geographic scope",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows[0].cells.find(
          (c) => c.fact
        )!.fact!.dimensions["srt:StatementGeographicalAxis"] = "country:US";
      }
    ],
    [
      "duplicate domestic subtotal",
      (p) => {
        p.segments!.push({ ...p.segments![0], id: "duplicate-domestic" });
      }
    ],
    [
      "missing original row",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows.splice(1, 1);
      }
    ],
    [
      "primary consolidated amount",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.primary.revenue.cells.find(
          (c) => c.fact
        )!.fact!.value += 1;
      }
    ],
    [
      "primary title",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.primary.title = "Affiliate revenue";
      }
    ],
    [
      "visible year",
      (p) => {
        p
          .businessBreakdownSource!.churchDwightRevenue!.headerRows.flatMap((r) => r.cells)
          .find((c) => c.label === "2025")!.label = "2024";
      }
    ],
    [
      "YTD duration",
      (p) => {
        p
          .businessBreakdownSource!.churchDwightRevenue!.headerRows.flatMap((r) => r.cells)
          .find((c) => c.label === "Six Months Ended")!.label = "Three Months Ended";
      }
    ],
    [
      "missing source proof",
      (p) => {
        delete p.businessBreakdownSource!.churchDwightRevenue;
      }
    ],
    [
      "foreign issuer",
      (p) => {
        p.businessBreakdownSource!.churchDwightRevenue!.rows[0].cells.find(
          (c) => c.fact
        )!.fact!.cik = "0000010456";
      }
    ],
    [
      "changed method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "invented gross profit",
      (p) => {
        p.segments![0].grossProfit = 100000000;
      }
    ]
  ];
  for (const [name, mutate] of mutations)
    it(`withholds ${name} when replaying stored original proof`, () => {
      const p = structuredClone(
        churchDwightOriginalFixture(name === "YTD duration" ? "quarterly" : "annual").period
      );
      mutate(p);
      expect(churchDwightRevenueProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
      expect(flowPeriod(p)).toBeUndefined();
    });
  it("withholds changed source classifications without a generic fallback", () => {
    const s = churchDwightOriginalFixture("annual");
    const changed = s.html.replaceAll(
      "chd:HouseholdProductsMember",
      "chd:ChangedClassificationMember"
    );
    const out = readGenericFiling(
      changed,
      s.identity,
      s.source.filing,
      companyFromFilingPeriods(s.identity, [s.retained]),
      []
    );
    expect(out.every((p) => !p.coverage.segments)).toBe(true);
    expect(out.every((p) => !p.businessBreakdownSource?.churchDwightRevenue)).toBe(true);
  });
  it("refuses foreign source identity", () => {
    const s = churchDwightOriginalFixture("annual");
    const foreign: CatalogCompany = { ...s.identity, cik: "0000010456", ticker: "BAX" };
    expect(() => readGenericFiling(s.html, foreign, s.source.filing, undefined, [])).toThrow(
      /identity mismatch/
    );
  });
});
