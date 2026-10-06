import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";
import { operatingNetItemsProblem } from "../src/features/finance/operating-net-items";
import { shareholderBridgeProblem } from "../src/features/finance/shareholder-bridge";

const cases = [
  [
    "DLROperatingNetFY2017",
    {
      revenue: 2457928e3,
      costs: 2006633e3,
      operating: 451295e3,
      consolidated: 256267e3,
      net: 248259e3,
      common: 173148e3
    }
  ],
  [
    "DLROperatingNetFY2025",
    {
      revenue: 6112692e3,
      costs: 5454200e3,
      operating: 658492e3,
      consolidated: 1313165e3,
      net: 1308589e3,
      common: 1267865e3
    }
  ],
  [
    "DLROperatingNet2020Q3",
    {
      revenue: 1024668e3,
      costs: 880265e3,
      operating: 144403e3,
      consolidated: -1454e3,
      net: -138e3,
      common: -37370e3
    }
  ],
  [
    "DLROperatingNet2024Q2",
    {
      revenue: 1356749e3,
      costs: 1346860e3,
      operating: 9889e3,
      consolidated: 74668e3,
      net: 80220e3,
      common: 70039e3
    }
  ],
  [
    "DLROperatingNet2026Q2",
    {
      revenue: 1924040e3,
      costs: 1464783e3,
      operating: 467245e3,
      consolidated: 457607e3,
      net: 453289e3,
      common: 443108e3
    }
  ]
] as const;

describe("original DLR operating-to-net statements", () => {
  for (const [key, expected] of cases) {
    it(`${key}: preserves original source stages and business proportions without a fabricated pretax subtotal`, () => {
      const { period, company } = reviewedFixture(key);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metrics).toMatchObject({
        revenue: expected.revenue,
        totalOperatingCosts: expected.costs,
        operatingIncome: expected.operating,
        netIncome: expected.net
      });
      expect(period.operatingNetItems!.consolidated.amount).toBe(expected.consolidated);
      expect(period.shareholderBridge?.common.amount).toBe(expected.common);
      expect(period.metrics.pretaxIncome).toBeUndefined();
      expect(period.metrics.grossProfit).toBeUndefined();
      expect(period.metrics.operatingExpenses).toBeUndefined();
      expect(period.metricSources.totalOperatingCosts?.tag).toBe("us-gaap:OperatingExpenses");
      expect(operatingNetItemsProblem(period)).toBeUndefined();
      expect(shareholderBridgeProblem(period)).toBeUndefined();
      expect(businessPeriod(period)?.segments?.length).toBeGreaterThanOrEqual(2);
      validateV2(company);
      const result = buildStatementFlow(flowPeriod(period)!);
      if (!result.ok) throw new Error(result.reason);
      expect(result.graph.nodes.some((n) => n.id === "pretax")).toBe(false);
      expect(result.graph.nodes.find((n) => n.id === "operating")?.signedAmount).toBe(
        expected.operating
      );
      expect(result.graph.nodes.find((n) => n.id === "consolidated-net")?.signedAmount).toBe(
        expected.consolidated
      );
      expect(result.graph.nodes.find((n) => n.id === "common-net")?.signedAmount).toBe(
        expected.common
      );
      if (period.operatingNetItems!.operatingSubtotal)
        expect(
          result.graph.nodes.find((n) => n.id === "operating-before-gains")?.signedAmount
        ).toBe(period.operatingNetItems!.operatingSubtotal!.amount);
      for (const item of period.operatingNetItems!.netItems.filter((l) => l.amount !== 0))
        expect(
          result.graph.nodes.find((n) => n.id === `operating-net-item-${item.id}`)?.signedAmount
        ).toBe(item.amount);
      for (const node of result.graph.nodes)
        for (const direction of ["source", "target"] as const) {
          const links = result.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(links.reduce((sum, l) => sum + l.value, 0)).toBeCloseTo(node.amount, 5);
        }
      const layout = layoutStatementFlow(result.graph);
      const revenue = layout.nodes.find((n) => n.id === "revenue")!;
      for (const segment of period.segments!) {
        const node = layout.nodes.find((n) => n.id === `segment-${segment.id}`)!;
        expect(node.height / revenue.height).toBeCloseTo(
          segment.revenue / period.metrics.revenue!,
          12
        );
      }
    });
  }

  it("keeps an independently reported tax-note pretax metric outside the primary accounting graph", () => {
    const { period, company, identity, filing, html } = reviewedFixture("DLROperatingNetFY2025");
    // Original DLR FY2025 tax note reports 1,345,207 thousand; its primary
    // operating-to-net rows reconcile exactly without that separate subtotal.
    period.metrics.pretaxIncome = 1345207e3;
    period.metricSources.pretaxIncome = {
      ...period.metricSources.netIncome!,
      tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      label: "Separately reported tax-note pretax income"
    };
    const refreshed = readGenericFiling(html, identity, filing, company).find(
      (p) => p.id === period.id
    )!;
    expect(refreshed.metrics.pretaxIncome).toBe(1345207e3);
    expect(flowPeriod(refreshed)).toBeDefined();
    const graph = buildStatementFlow(flowPeriod(refreshed)!);
    if (!graph.ok) throw Error(graph.reason);
    expect(graph.graph.nodes.some((n) => n.id === "pretax")).toBe(false);
  });

  it("retains a debt gain occurring after the original tax row", () => {
    const { period } = reviewedFixture("DLROperatingNetFY2017");
    const items = period.operatingNetItems!.netItems;
    expect(items.at(-2)?.tag).toBe("us-gaap:IncomeTaxExpenseBenefit");
    expect(items.at(-1)).toMatchObject({
      tag: "us-gaap:GainsLossesOnExtinguishmentOfDebt",
      amount: 1990e3,
      effect: "gain"
    });
  });

  it("adds a signed redemption gain once without negating its original reported loss", () => {
    const { period } = reviewedFixture("DLROperatingNet2020Q3");
    const allocation = period.shareholderBridge!.allocations.find((l) => l.effect === "gain")!;
    expect(allocation.amount).toBe(-16520e3);
    expect(shareholderBridgeProblem(period)).toBeUndefined();
    const bad = structuredClone(period);
    delete bad.shareholderBridge!.allocations.find((l) => l.effect === "gain")!.effect;
    expect(shareholderBridgeProblem(bad)).toBeTruthy();
  });

  for (const change of [
    "amount",
    "caption",
    "dimension",
    "row",
    "provenance",
    "precision",
    "subtotal",
    "tax",
    "unknown",
    "invented-pretax",
    "mixed-proof"
  ] as const)
    it(`withholds a changed ${change} proof instead of balancing it`, () => {
      const { period } = reviewedFixture("DLROperatingNet2026Q2");
      const p = period.operatingNetItems!;
      if (change === "amount") p.netItems[0].amount += 1e3;
      if (change === "caption") p.costs[0].label = "Unreviewed lease scope";
      if (change === "dimension")
        p.costs[0].dimensions = { "srt:ProductOrServiceAxis": "dlr:FeeIncomeAndOtherMember" };
      if (change === "row") p.netItems[0].rowIndex++;
      if (change === "provenance") p.sourceUrl = p.sourceUrl.replace("1297996", "1035443");
      if (change === "precision") delete p.costs[0].decimals;
      if (change === "subtotal") p.operatingSubtotal!.amount += 1e3;
      if (change === "tax")
        p.netItems = p.netItems.filter((l) => l.tag !== "us-gaap:IncomeTaxExpenseBenefit");
      if (change === "unknown") p.netItems[0].tag = "dlr:UnreviewedGain";
      if (change === "invented-pretax") {
        period.metrics.pretaxIncome = period.metrics.netIncome! + period.metrics.incomeTax!;
        period.metricSources.pretaxIncome = {
          ...period.metricSources.netIncome!,
          method: "calculated"
        };
      }
      if (change === "mixed-proof") period.operatingExpensesBasis = "expenses-and-other-items-net";
      expect(operatingNetItemsProblem(period)).toBeTruthy();
      expect(flowPeriod(period)).toBeUndefined();
    });

  it("withholds an unknown source row, a conflicting reported anchor and another issuer", () => {
    const { identity, filing, html, basic, company } = reviewedFixture("DLROperatingNet2026Q2");
    company.quarterly = [basic];
    for (const source of [
      html.replaceAll("us-gaap:OperatingLeaseExpense", "dlr:UnknownCost"),
      html.replaceAll(
        "dlr:BusinessCombinationAcquisitionAndIntegrationRelatedCosts",
        "dlr:UnreviewedAcquisitionCost"
      )
    ])
      expect(
        readGenericFiling(source, identity, filing, company).some((p) => p.operatingNetItems)
      ).toBe(false);
    basic.metrics.operatingIncome = 467246e3;
    expect(
      readGenericFiling(html, identity, filing, company).some((p) => p.operatingNetItems)
    ).toBe(false);
    expect(() =>
      readGenericFiling(html, { ...identity, cik: "0001035443" }, filing, company)
    ).toThrow("identity mismatch");
  });
});
