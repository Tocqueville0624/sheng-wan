import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cencoraCases, cencoraFixture } from "./fixtures/finance/cencora-fixture";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { cencoraRevenueProblem } from "../src/features/finance/cencora-revenue";
import { enrichCencoraBusinessPeriods } from "../scripts/finance/cencora-business-v2";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("Original Cencora product hierarchies and signed intersegment eliminations", () => {
  for (const id of cencoraCases) {
    it(`${id} preserves financial facts and every original monetary column while counting product leaves once`, () => {
      const s = cencoraFixture(id),
        p = s.period;
      expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
      expect(p?.coverage.segments).toBe(true);
      for (const key of [
        "metrics",
        "metricSources",
        "startDate",
        "endDate",
        "sourceUrl",
        "accession",
        "filedAt",
        "fiscalYear",
        "fiscalQuarter",
        "reportingCurrency",
        "displayCurrency",
        "operatingCostDetails",
        "operatingExpenseDetails"
      ] as const)
        if (s.retained[key] !== undefined) expect(p[key]).toEqual(s.retained[key]);
      expect(p.segments).toEqual(s.source.expectedBusiness);
      expect(p.revenueAdjustments).toEqual(s.source.expectedAdjustments);
      expect(cencoraRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(
        p.segments!.reduce((n, b) => n + b.revenue, 0) +
          p.revenueAdjustments!.reduce((n, b) => n + b.revenue, 0)
      ).toBe(p.metrics.revenue);
      expect(p.revenueAdjustments![0].revenue).toBeLessThan(0);
      expect(p.revenueAdjustments![0].revenueSource!.dimensions).toEqual({
        "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
      });
      validateV2(companyFromFilingPeriods(s.identity, [p]));
      const direct = enrichCencoraBusinessPeriods(
        s.html,
        s.identity,
        s.source.filing,
        [s.retained],
        parseInlineXbrl(s.html)
      )[0];
      for (const [key, value] of Object.entries(s.retained))
        if (
          ![
            "coverage",
            "segments",
            "revenueAdjustments",
            "businessBreakdownSource",
            "segmentSourceUrl",
            "segmentBasis"
          ].includes(key)
        )
          expect((direct as unknown as Record<string, unknown>)[key]).toEqual(value);
      const flow = flowPeriod(p)!;
      expect(flow).toBeDefined();
      const result = buildStatementFlow(flow);
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.reason);
      for (const b of p.segments!)
        expect(
          result.graph.links
            .filter((l) => l.source === `segment-${b.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(b.revenue);
      expect(result.graph.nodes.some((n) => n.label === "Pre-adjustment revenue")).toBe(true);
      expect(result.graph.nodes.some((n) => n.label.startsWith("Intersegment eliminations"))).toBe(
        true
      );
    });
    it(`${id} imports the original current period without saved financial data or Company Facts`, () => {
      const s = cencoraFixture(id, true);
      expect(s.period?.coverage.segments).toBe(true);
      expect(s.period.endDate).toBe(s.source.filing.reportDate);
      expect(cencoraRevenueProblem(s.period)).toBeUndefined();
      expect(flowPeriod(s.period)).toBeDefined();
      validateV2(companyFromFilingPeriods(s.identity, s.periods));
    });
  }
  it("uses calendar-year Q1 headings for the September fiscal year, including a physically shifted comparative band", () => {
    const p = cencoraFixture("2026-Q1").period;
    expect([p.startDate, p.endDate, p.fiscalYear, p.fiscalQuarter]).toEqual([
      "2025-10-01",
      "2025-12-31",
      2026,
      1
    ]);
    expect(
      p
        .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
        .some((c) => c.label === "2025")
    ).toBe(true);
  });
  it("keeps an explicitly reported zero Alliance business instead of borrowing a later annual mix", () => {
    const p = cencoraFixture("2021-Q2").period;
    expect(p.segments!.find((b) => b.label === "Alliance Healthcare")?.revenue).toBe(0);
    expect(p.segments!.some((b) => /^Total /.test(b.label))).toBe(false);
  });
  it("withholds the entire malformed original annual hierarchy without correcting original quarterly dates", () => {
    const s = cencoraFixture("FY2020");
    expect(s.period?.coverage.segments).not.toBe(true);
    expect(s.period?.metrics).toEqual(s.retained.metrics);
    expect(
      readGenericFiling(s.html, s.identity, s.source.filing, undefined, []).some(
        (p) => p.coverage.segments
      )
    ).toBe(false);
  });
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "missing physical row",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.rows.splice(5, 1);
      }
    ],
    [
      "changed original section",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.rows.find(
          (r) => r.cells[0]?.label === "U.S. Healthcare Solutions"
        )!.cells[0].label = "Unknown business";
      }
    ],
    [
      "changed original comparative date",
      (p) => {
        p
          .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
          .filter((c) => c.fact)
          .at(-1)!.fact!.startDate = "2025-01-01";
      }
    ],
    [
      "changed original header year",
      (p) => {
        p
          .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
          .find((c) => c.label === "2026")!.label = "2025";
      }
    ],
    [
      "unknown business axis",
      (p) => {
        p
          .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact)!.fact!.dimensions["UnknownAxis"] = "UnknownMember";
      }
    ],
    [
      "removed original unit",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.units = [];
      }
    ],
    [
      "changed primary amount",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.primary.revenue.cells.find(
          (c) => c.fact
        )!.fact!.value += 1000;
      }
    ],
    [
      "missing comparative tax",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.primary.tax.cells =
          p.businessBreakdownSource!.cencoraRevenue!.primary.tax.cells.filter(
            (c) => !c.fact || c.fact.endDate === p.endDate
          );
      }
    ],
    [
      "annual label on a quarter",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.form = "10-K";
      }
    ],
    [
      "wrong fiscal focus",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue!.originalFiscalYear++;
      }
    ],
    [
      "changed source issuer",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("/1140859/", "/8818/");
      }
    ],
    [
      "unreported positive branch",
      (p) => {
        p.segments!.push({ ...p.segments![0], id: "invented" });
      }
    ],
    [
      "negative branch",
      (p) => {
        p.segments![0].revenue = -1;
      }
    ],
    [
      "missing elimination",
      (p) => {
        delete p.revenueAdjustments;
      }
    ],
    [
      "absolute elimination",
      (p) => {
        p.revenueAdjustments![0].revenue *= -1;
      }
    ],
    [
      "changed retained revenue",
      (p) => {
        p.metrics.revenue! += 1;
      }
    ],
    [
      "changed business provenance",
      (p) => {
        p.segments![0].revenueSource!.sourceUrl += "?alternate";
      }
    ],
    [
      "proof smuggled under generic method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "invented revenue classification",
      (p) => {
        p.businessBreakdownSource!.axis = "us-gaap:StatementBusinessSegmentsAxis";
      }
    ],
    [
      "changed source precision",
      (p) => {
        p
          .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact)!.fact!.declarations[0].decimals = "-6";
      }
    ],
    [
      "unverified original dollar scale",
      (p) => {
        p
          .businessBreakdownSource!.cencoraRevenue!.rows.flatMap((r) => r.cells)
          .find((c) => c.label === "(in thousands)")!.label = "(in millions)";
      }
    ]
  ];
  for (const [name, change] of mutations)
    it(`rejects ${name} on stored reads`, () => {
      const p = structuredClone(cencoraFixture("2026-Q3").period);
      change(p);
      expect(businessPeriod(p)).toBeUndefined();
    });
  it("rejects changed original HTML context dates at import", () => {
    const s = cencoraFixture("2026-Q3");
    const changed = s.html.replaceAll("2026-04-01", "2026-04-02");
    expect(changed).not.toBe(s.html);
    expect(
      readGenericFiling(
        changed,
        s.identity,
        s.source.filing,
        companyFromFilingPeriods(s.identity, [s.retained]),
        []
      ).find((p) => p.id === "2026-Q3")?.coverage.segments
    ).not.toBe(true);
  });
});
