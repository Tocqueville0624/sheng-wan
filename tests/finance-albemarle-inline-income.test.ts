import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import source from "./fixtures/finance/alb-2022-q2-original-operating-gains.json" with { type: "json" };
import {
  albemarleInlineFixture,
  albemarleInlineBasic,
  albemarleInlineHtml,
  albemarleInlineFiling,
  albemarleInlineIdentity
} from "./fixtures/finance/albemarle-inline-income-fixtures";
import { flowPeriod, validateV2, businessPeriod } from "../scripts/finance/v2-model";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { currentFilingCandidates } from "../scripts/finance/current-filing";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { enrichAlbemarleInlineIncomePeriods } from "../scripts/finance/albemarle-inline-income-v2";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import { grossOperatingItemsProblem } from "../src/features/finance/gross-operating-items";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("original Albemarle signed quarterly business-sale income", () => {
  it("pins the unchanged original source excerpt", () =>
    expect(createHash("sha256").update(albemarleInlineHtml).digest("hex")).toBe(
      source.excerptSha256
    ));
  it("retains original comparative metrics and routes a gain exceeding operating expenses", () => {
    const { period: p, basic, company } = albemarleInlineFixture();
    for (const [key, value] of Object.entries(basic.metrics))
      expect(p.metrics[key as keyof typeof p.metrics]).toBe(value);
    for (const [key, value] of Object.entries(basic.metricSources))
      expect(p.metricSources[key as keyof typeof p.metricSources]).toEqual(value);
    expect(p.metrics.operatingExpenses).toBe(-293916000);
    expect(p.metrics.equityMethodIncome).toBe(17998000);
    expect(p.metrics.discontinuedOperationsIncome).toBeUndefined();
    expect(p.grossOperatingItems?.operatingCosts.map((l) => l.amount)).toEqual([
      121516000, 13976000, -429408000
    ]);
    expect(
      p.grossOperatingItems?.inlineSource?.rows[8].cells.every((c) => !c.fact && !c.label)
    ).toBe(true);
    expect(grossOperatingItemsProblem(p)).toBeUndefined();
    expect(businessPeriod(p)).toBeDefined();
    validateV2(company);
    const graph = buildStatementFlow(flowPeriod(JSON.parse(JSON.stringify(p)))!);
    expect(graph.ok).toBe(true);
    if (!graph.ok) throw Error(graph.reason);
    const node = (id: string) => graph.graph.nodes.find((n) => n.id === id)!;
    expect(node("opex").amount).toBe(135492000);
    expect(node("opex").label).toBe("Operating expenses (before business-sale gains)");
    expect(node("operating-reversal-alb-inline-income-9").amount).toBe(429408000);
    expect(node("equity").amount).toBe(17998000);
    expect(node("noncontrolling").amount).toBe(21608000);
    expect(node("revenue").amount).toBe(773896000);
    for (const n of graph.graph.nodes) {
      const ins = graph.graph.links
        .filter((l) => l.target === n.id)
        .reduce((s, l) => s + l.value, 0);
      const outs = graph.graph.links
        .filter((l) => l.source === n.id)
        .reduce((s, l) => s + l.value, 0);
      if (ins && outs) expect(ins).toBe(outs);
    }
  });
  it("reads current primary financial and business scopes without saved data or Company Facts", () => {
    const { period: p, company } = albemarleInlineFixture("source-only");
    expect(p.id).toBe("2022-Q2");
    expect(p.metrics.revenue).toBe(1479593000);
    expect(p.metrics.netIncome).toBe(406773000);
    expect(p.metrics.equityMethodIncome).toBe(128156000);
    expect(p.metrics.operatingExpenses).toBe(146328000);
    expect(p.metricSources.operatingExpenses?.method).toBe("calculated");
    expect(p.metricSources.operatingExpenses?.decimals).toBeUndefined();
    expect(flowPeriod(p)).toBeDefined();
    expect(businessPeriod(p)).toBeDefined();
    validateV2(company);
  });
  it("the reviewed income reader completes an original revenue-only private candidate", () => {
    const parsed = parseInlineXbrl(albemarleInlineHtml);
    const seeds = currentFilingCandidates(
      albemarleInlineIdentity,
      albemarleInlineFiling,
      parsed,
      []
    );
    expect(seeds).toHaveLength(1);
    expect(Object.keys(seeds[0].metrics)).toEqual(["revenue"]);
    const next = enrichAlbemarleInlineIncomePeriods(
      albemarleInlineHtml,
      albemarleInlineIdentity,
      albemarleInlineFiling,
      seeds,
      parsed
    );
    expect(next).toHaveLength(1);
    expect(next[0].metrics.netIncome).toBe(406773000);
    expect(next[0].metrics.equityMethodIncome).toBe(128156000);
    expect(next[0].metricSources.revenue).toEqual(seeds[0].metricSources.revenue);
    expect(next[0].grossOperatingItems?.operatingCosts[2].amount).toBe(0);
    expect(flowPeriod(next[0])).toBeDefined();
    validateV2(companyFromFilingPeriods(albemarleInlineIdentity, next));
  });
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "unproved negative expense",
      (p) => {
        delete p.grossOperatingItems;
      }
    ],
    [
      "missing original proof",
      (p) => {
        delete p.grossOperatingItems!.inlineSource;
      }
    ],
    [
      "changed gain",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].amount += 1000;
      }
    ],
    [
      "gain mislabeled revenue",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].label = "Revenue";
      }
    ],
    [
      "missing R&D",
      (p) => {
        p.grossOperatingItems!.operatingCosts.splice(1, 1);
      }
    ],
    [
      "calculated precision",
      (p) => {
        p.metricSources.operatingExpenses!.decimals = -3;
      }
    ],
    [
      "calculation mislabeled reported",
      (p) => {
        p.metricSources.operatingExpenses!.method = "reported";
      }
    ],
    [
      "equity moved before tax",
      (p) => {
        delete p.metrics.equityMethodIncome;
        p.metrics.afterTaxSubsidiaryIncome = 17998000;
      }
    ],
    [
      "invented discontinued zero",
      (p) => {
        p.metrics.discontinuedOperationsIncome = 0;
      }
    ],
    [
      "wrong parent income",
      (p) => {
        p.metrics.netIncome = 446208000;
      }
    ],
    [
      "wrong source",
      (p) => {
        p.grossOperatingItems!.sourceUrl = p.sourceUrl.replace("915913/", "63908/");
      }
    ],
    [
      "fake original gap line",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[8].cells[0].label = "Other operating expense";
      }
    ],
    [
      "changed quarter heading",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[1].cells.find((c) =>
          c.label.startsWith("Three")
        )!.label = "Six Months Ended June 30,";
      }
    ],
    [
      "changed year heading",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[2].cells.find((c) => c.label === "2021")!.label =
          "2020";
      }
    ],
    [
      "changed currency",
      (p) => {
        p.grossOperatingItems!.inlineSource!.units[0].measure = "iso4217:CAD" as "iso4217:USD";
      }
    ],
    [
      "changed sign declaration",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[9].cells.find(
          (c) => c.fact?.startDate === "2021-04-01"
        )!.fact!.declarations[0].sign = "-";
      }
    ],
    [
      "dimension substituted",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[17].cells.find(
          (c) => c.fact?.startDate === "2021-04-01"
        )!.fact!.dimensions = { "us-gaap:StatementBusinessSegmentsAxis": "alb:LithiumMember" };
      }
    ],
    [
      "altered unselected YTD column",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[9].cells.find(
          (c) => c.fact?.startDate === "2022-01-01"
        )!.fact!.value += 1000;
      }
    ],
    [
      "changed physical source sign",
      (p) => {
        p.grossOperatingItems!.inlineSource!.rows[9].cells.find(
          (c) => c.fact?.startDate === "2021-04-01"
        )!.label = "429,408";
      }
    ],
    [
      "competing source rounding",
      (p) => {
        p.operatingReconciliation = {
          label: "Source rounding",
          amount: 1000,
          basis: "gross-profit",
          sourceUrl: p.sourceUrl
        };
      }
    ]
  ];
  it.each(mutations)("withholds %s", (_name, mutate) => {
    const p = structuredClone(albemarleInlineFixture().period);
    mutate(p);
    expect(flowPeriod(p)).toBeUndefined();
  });
  it("withholds a source mutation before merging preserved financial amounts", () => {
    const changed = albemarleInlineHtml.replace(/429,408/g, "429,409");
    const base = companyFromFilingPeriods(albemarleInlineIdentity, [
      structuredClone(albemarleInlineBasic)
    ]);
    expect(
      readGenericFiling(changed, albemarleInlineIdentity, albemarleInlineFiling, base).some(
        (p) => p.id === "2021-Q2" && p.coverage.sankey
      )
    ).toBe(false);
    expect(base.quarterly[0].metrics).toEqual(albemarleInlineBasic.metrics);
  });
});
