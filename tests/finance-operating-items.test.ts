import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { operatingItemsProblem } from "../src/features/finance/operating-items";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";

describe("source-reviewed operating costs and gains", () => {
  for (const source of [
    { key: "APDOperatingAnnual", cost: 13091.7e6, gain: 177.4e6, operating: -877e6, net: -394.5e6 },
    { key: "APDOperatingQuarter", cost: 5273e6, gain: 14.9e6, operating: -2097.1e6, net: -1440.8e6 }
  ] as const) {
    it(`${source.key}: recovers costs and gains independently from original statement rows`, () => {
      const { period, company, basic, identity, filing, html } = reviewedFixture(source.key);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metrics.totalOperatingCosts).toBe(source.cost);
      expect(period.metrics.operatingIncome).toBe(source.operating);
      expect(period.metrics.netIncome).toBe(source.net);
      expect(period.metrics.grossProfit).toBeUndefined();
      expect(period.metrics.equityMethodIncome).toBeUndefined();
      expect(period.metrics.discontinuedOperationsIncome).toBe(
        source.key === "APDOperatingAnnual" ? -8e6 : undefined
      );
      const proof = period.operatingItems!;
      expect(proof.items.filter((r) => r.effect === "gain").reduce((s, r) => s + r.amount, 0)).toBe(
        source.gain
      );
      expect(period.metrics.revenue! + source.gain - source.cost).toBe(source.operating);
      expect(period.operatingCostDetails!.reduce((s, r) => s + r.amount, 0)).toBe(source.cost);
      expect(period.operatingCostDetails!.some((r) => r.tag === "apd:OtherIncomeExpenseNet")).toBe(
        false
      );
      expect(businessPeriod(period)?.segments).toHaveLength(3);
      expect(operatingItemsProblem(period)).toBeUndefined();
      validateV2(company);
      const graph = buildStatementFlow(flowPeriod(period)!);
      if (!graph.ok) throw new Error(graph.reason);
      expect(graph.graph.signedAccounting).toBe(true);
      for (const node of graph.graph.nodes)
        for (const direction of ["source", "target"] as const) {
          const links = graph.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(links.reduce((s, l) => s + l.value, 0)).toBeCloseTo(node.amount, 5);
        }
      const layout = layoutStatementFlow(graph.graph);
      const height = layout.nodes.find((n) => n.id === "revenue")!.height;
      for (const segment of period.segments!)
        expect(
          layout.nodes.find((n) => n.id === `segment-${segment.id}`)!.height / height
        ).toBeCloseTo(segment.revenue / period.metrics.revenue!, 10);
      const revenueOnly = structuredClone(basic);
      revenueOnly.metrics = { revenue: period.metrics.revenue };
      revenueOnly.metricSources = { revenue: basic.metricSources.revenue };
      revenueOnly.coverage = { basics: true, segments: false, sankey: false };
      const fresh = readGenericFiling(html, identity, filing, {
        ...company,
        [period.kind]: [revenueOnly]
      }).find((p) => p.id === period.id)!;
      expect(fresh.coverage).toEqual(period.coverage);
      expect(fresh.operatingItems).toEqual(proof);
      expect(fresh.metrics).toMatchObject({
        revenue: period.metrics.revenue,
        totalOperatingCosts: source.cost,
        operatingIncome: source.operating,
        netIncome: source.net
      });
      if (source.key === "APDOperatingQuarter")
        expect(proof.items.filter((r) => r.amount === 0)).toHaveLength(2);
    });
  }

  for (const change of [
    "amount",
    "effect",
    "source",
    "date",
    "tag",
    "order",
    "detail",
    "rule"
  ] as const)
    it(`withholds an operating ledger with changed ${change}`, () => {
      const { period, company } = reviewedFixture("APDOperatingAnnual");
      const changed = structuredClone(period),
        proof = changed.operatingItems!;
      if (change === "amount") proof.items.at(-1)!.amount += 1e6;
      if (change === "effect") proof.items.at(-1)!.effect = "cost";
      if (change === "source") proof.sourceUrl = proof.sourceUrl.replace("/2969/", "/37996/");
      if (change === "date") proof.startDate = "2024-01-01";
      if (change === "tag") proof.items.at(-1)!.tag = "apd:UnknownOperatingItem";
      if (change === "order") proof.items.reverse();
      if (change === "detail") changed.operatingCostDetails![0].amount += 1e6;
      if (change === "rule") proof.ruleId = "unreviewed-operating-items";
      expect(operatingItemsProblem(changed)).toBeTruthy();
      expect(flowPeriod(changed)).toBeUndefined();
      expect(businessPeriod(changed)).toBeTruthy();
      expect(() => validateV2({ ...company, annual: [changed] })).toThrow();
    });

  it("keeps independently validated business revenue when a current source changes its custom gain concept", () => {
    const { html, identity, filing, basic, company } = reviewedFixture("APDOperatingQuarter");
    const renamed = html.replaceAll(
      'name="apd:OtherIncomeExpenseNet"',
      'name="apd:UnreviewedOtherIncomeExpenseNet"'
    );
    expect(renamed).not.toBe(html);
    const result = readGenericFiling(renamed, identity, filing, {
      ...company,
      quarterly: [basic]
    }).find((p) => p.id === basic.id)!;
    expect(result.operatingItems).toBeUndefined();
    expect(result.coverage.segments).toBe(true);
    expect(result.coverage.sankey).toBe(false);
    validateV2({ ...company, quarterly: [result] });
  });

  it("keeps the actual nested FY2021 facility-closure loss separate from operating costs", () => {
    const { period, company } = reviewedFixture("APDOperating2021");
    expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
    expect(period.metrics).toMatchObject({
      totalOperatingCosts: 8108e6,
      operatingIncome: 2281.4e6,
      discontinuedOperationsIncome: 70.3e6,
      noncontrollingInterestIncome: 15.8e6,
      netIncome: 2099.1e6
    });
    expect(period.operatingItems!.items.find((r) => r.label === "Facility closure")).toMatchObject({
      effect: "gain",
      amount: -23.2e6
    });
    const graph = buildStatementFlow(flowPeriod(period)!);
    if (!graph.ok) throw new Error(graph.reason);
    expect(graph.graph.nodes.find((n) => n.label === "Facility closure")?.signedAmount).toBe(
      -23.2e6
    );
    validateV2(company);
  });

  it("sums the separately reported continuing and discontinued NCI scopes without double counting", () => {
    const { period, basic, company, identity, html, filing } = reviewedFixture("APDOperating2016");
    expect(period.coverage).toEqual({ basics: true, segments: false, sankey: true });
    expect(period.metrics).toMatchObject({
      totalOperatingCosts: 6018e6,
      noncontrollingInterestIncome: 30.4e6,
      discontinuedOperationsIncome: -460.5e6,
      netIncome: 631.1e6
    });
    const component = parseInlineXbrl(html).facts.find(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        f.tag === "us-gaap:IncomeLossFromContinuingOperationsAttributableToNoncontrollingEntity"
    )!;
    expect(component.value).toBe(22.5e6);
    const seed = structuredClone(basic);
    seed.metrics.noncontrollingInterestIncome = component.value;
    seed.metricSources.noncontrollingInterestIncome = {
      ...seed.metricSources.revenue!,
      tag: component.tag,
      decimals: component.decimals
    };
    const recovered = readGenericFiling(html, identity, filing, {
      ...company,
      annual: [seed]
    }).find((p) => p.id === period.id)!;
    expect(recovered.coverage.sankey).toBe(true);
    expect(recovered.metrics.noncontrollingInterestIncome).toBe(30.4e6);
    expect(recovered.metricSources.noncontrollingInterestIncome).toMatchObject({
      method: "calculated"
    });
    validateV2(company);
  });

  for (const source of [
    {
      key: "CRLOperatingAnnual",
      cost: 3990220e3,
      operating: 25162e3,
      pretax: -99503e3,
      net: -144338e3
    },
    {
      key: "CRLOperatingQuarter",
      cost: 884190e3,
      operating: 119888e3,
      pretax: 53170e3,
      net: -1482e3
    }
  ] as const)
    it(`${source.key}: preserves two exclusive service/product cost scopes and the source pretax row`, () => {
      const { period, company } = reviewedFixture(source.key);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metrics).toMatchObject({
        totalOperatingCosts: source.cost,
        operatingIncome: source.operating,
        pretaxIncome: source.pretax,
        netIncome: source.net
      });
      expect(period.metrics.grossProfit).toBeUndefined();
      expect(period.operatingItems!.items.filter((r) => r.effect === "gain")).toHaveLength(0);
      const costs = period.operatingItems!.items.filter(
        (r) => r.tag === "us-gaap:CostOfGoodsAndServicesSold"
      );
      expect(costs.map((r) => r.dimensions)).toEqual([
        { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" },
        { "srt:ProductOrServiceAxis": "us-gaap:ProductMember" }
      ]);
      expect(period.metricSources.pretaxIncome?.tag).toBe(
        "us-gaap:IncomeLossIncludingPortionAttributableToNoncontrollingInterest"
      );
      validateV2(company);
      for (const change of ["cost-scope", "anchor-scope", "detail-scope"] as const) {
        const changed = structuredClone(period);
        if (change === "cost-scope")
          changed.operatingItems!.items[0].dimensions = {
            "srt:ProductOrServiceAxis": "us-gaap:ProductMember"
          };
        if (change === "anchor-scope")
          changed.operatingItems!.revenue.dimensions = {
            "srt:ProductOrServiceAxis": "us-gaap:ProductMember"
          };
        if (change === "detail-scope") changed.operatingCostDetails![0].dimensions = {};
        expect(operatingItemsProblem(changed)).toBeTruthy();
        expect(flowPeriod(changed)).toBeUndefined();
        expect(businessPeriod(changed)).toBeTruthy();
      }
    });
});
