import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  originalBusinessCases,
  originalBusinessFixture,
  originalBusinessSource,
  type OriginalBusinessCase
} from "./fixtures/finance/original-business-fixtures";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("complete original systems/support and financial-service revenue sections", () => {
  for (const name of Object.keys(originalBusinessCases) as OriginalBusinessCase[]) {
    it(`${name} pins unmodified original source bytes`, () => {
      const s = originalBusinessSource(name);
      expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
    });
    it.each(["preserved", "source-only"] as const)(
      `${name} replays complete original rows (%s)`,
      (mode) => {
        const { period: p, basic, company } = originalBusinessFixture(name, mode);
        validateV2(JSON.parse(JSON.stringify(company)));
        expect(businessPeriod(p)).toBeDefined();
        expect(flowPeriod(p)).toBeDefined();
        expect(p.businessBreakdownSource?.originalRevenueRows).toBeDefined();
        expect(p.segments!.reduce((sum, s) => sum + s.revenue, 0)).toBe(p.metrics.revenue);
        expect(p.segments!.some((s) => s.grossProfit !== undefined)).toBe(false);
        if (mode === "preserved") {
          expect(p.metrics).toEqual(basic.metrics);
          expect(p.metricSources).toEqual(basic.metricSources);
          for (const field of [
            "sourceUrl",
            "accession",
            "filedAt",
            "startDate",
            "endDate",
            "fiscalYear",
            "fiscalQuarter",
            "reportingCurrency",
            "displayCurrency"
          ] as const)
            expect(p[field]).toEqual(basic[field]);
        }
        const graph = buildStatementFlow(flowPeriod(p)!);
        expect(graph.ok).toBe(true);
        if (!graph.ok) throw Error(graph.reason);
        for (const node of graph.graph.nodes) {
          const ins = graph.graph.links
            .filter((l) => l.target === node.id)
            .reduce((s, l) => s + l.value, 0);
          const outs = graph.graph.links
            .filter((l) => l.source === node.id)
            .reduce((s, l) => s + l.value, 0);
          if (ins && outs) expect(ins).toBe(outs);
        }
      }
    );
  }
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "missing original rows",
      (p) => {
        delete p.businessBreakdownSource!.originalRevenueRows;
      }
    ],
    [
      "unknown business row",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells[0].label = "New business";
      }
    ],
    [
      "untagged revenue",
      (p) => {
        delete p.businessBreakdownSource!.originalRevenueRows!.rows[5].cells.find((c) => c.fact)!
          .fact;
      }
    ],
    [
      "unknown original scope",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!.fact!.dimensions = { "srt:ProductOrServiceAxis": "issuer:UnknownMember" };
      }
    ],
    [
      "changed visible amount",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find((c) => c.fact)!.label =
          "1";
      }
    ],
    [
      "foreign issuer",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!.fact!.cik = "0000063908";
      }
    ],
    [
      "changed unit",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.units[0].measure =
          "iso4217:CAD" as "iso4217:USD";
      }
    ],
    [
      "changed declared scale",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!.fact!.declarations![0].scale = 0;
      }
    ],
    [
      "changed precision",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!.fact!.decimals = 0;
      }
    ],
    [
      "negative branch",
      (p) => {
        const c = p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!;
        c.fact!.value = -c.fact!.value;
        c.fact!.declarations![0].sign = "-";
      }
    ],
    [
      "changed source date",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows[4].cells.find(
          (c) => c.fact
        )!.fact!.endDate = "2020-12-31";
      }
    ],
    [
      "missing physical row",
      (p) => {
        p.businessBreakdownSource!.originalRevenueRows!.rows.splice(0, 1);
      }
    ],
    [
      "invented business gross profit",
      (p) => {
        p.segments![0].grossProfit = 0;
      }
    ],
    [
      "invented balancing revenue",
      (p) => {
        p.revenueAdjustments = [{ id: "source-rounding", label: "Source rounding", revenue: 0 }];
      }
    ],
    [
      "mislabelled classification",
      (p) => {
        p.segmentBasis = "Operating segments";
      }
    ],
    [
      "reordered branches",
      (p) => {
        p.segments!.reverse();
      }
    ],
    [
      "foreign accession",
      (p) => {
        p.accession = "0000063908-26-000073";
      }
    ]
  ];
  for (const name of ["LRCXQuarter", "HOODQuarter"] as const)
    it.each(mutations)(`${name} withholds %s`, (_, mutate) => {
      const p = structuredClone(originalBusinessFixture(name).period);
      mutate(p);
      expect(businessPeriod(p)).toBeUndefined();
    });
  it.each(["LRCXQuarter", "HOODQuarter"] as const)(
    "%s rejects a changed original duration heading",
    (name) => {
      const p = structuredClone(originalBusinessFixture(name).period);
      const c = p
        .businessBreakdownSource!.originalRevenueRows!.rows.flatMap((r) => r.cells)
        .find((c) => c.label.startsWith("Three Months"))!;
      c.label = c.label.replace("Three", "Six");
      expect(businessPeriod(p)).toBeUndefined();
    }
  );
  it("withholds a changed independent primary revenue", () => {
    const p = structuredClone(originalBusinessFixture("LRCXAnnual").period);
    p
      .businessBreakdownSource!.originalRevenueRows!.primaryRows!.at(-1)!
      .cells.find((c) => c.fact)!.fact!.value += 1000;
    expect(businessPeriod(p)).toBeUndefined();
  });
  it("withholds an added untagged zero business before the known revenue rows", () => {
    const s = originalBusinessSource("HOODQuarter");
    const original = [...s.html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].find(([row]) =>
      row.includes("Transaction-based revenues")
    )![0];
    const html = s.html.replace(
      original,
      '<tr><td colspan="3">New business</td><td colspan="21">0</td></tr>' + original
    );
    const p = readGenericFiling(html, s.identity, s.filing, undefined, []).find(
      (p) => p.id === s.source.period.id
    )!;
    expect(p.coverage.segments).toBe(false);
    expect(p.segments).toBeUndefined();
  });
  it("withholds a renamed original interest concept", () => {
    const s = originalBusinessSource("HOODQuarter");
    const html = s.html.replace(
      'name="us-gaap:InterestIncomeExpenseNet"',
      'name="hood:UnknownRevenue"'
    );
    const p = readGenericFiling(html, s.identity, s.filing, undefined, []).find(
      (p) => p.id === s.source.period.id
    )!;
    expect(p.coverage.segments).toBe(false);
    expect(p.segments).toBeUndefined();
  });
});
