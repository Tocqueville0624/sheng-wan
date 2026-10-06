import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichShareholderPeriods } from "../scripts/finance/shareholder-v2";
import {
  accountingTolerance,
  buildStatementFlow,
  layoutStatementFlow
} from "../src/features/finance/chart-model";

const cases = {
  MRNASigned: {
    revenue: 1944e6,
    operatingIncome: -3074e6,
    pretaxIncome: -2768e6,
    incomeTax: 54e6,
    netIncome: -2822e6
  },
  AXONSigned: {
    revenue: 2779536e3,
    grossProfit: 1658125e3,
    operatingIncome: -62076e3,
    pretaxIncome: 18974e3,
    incomeTax: -105682e3,
    netIncome: 124656e3
  }
};

describe("reported signed accounting statements", () => {
  for (const source of [
    { key: "FSigned", base: -1322e6, common: -1327e6, allocation: 5e6, scope: "consolidated" },
    { key: "HPESigned", base: 57e6, common: -59e6, allocation: 116e6, scope: "parent" }
  ] as const) {
    it(`${source.key}: retains independent net income and reported common-shareholder allocations`, () => {
      const { period, company, basic, html, identity, filing } = reviewedFixture(source.key);
      expect(period.metrics.netIncome).toBe(source.base);
      expect(period.shareholderBridge).toMatchObject({
        base: { amount: source.base, scope: source.scope },
        common: { amount: source.common },
        allocations: [{ amount: source.allocation }]
      });
      validateV2(company);
      const graph = buildStatementFlow(flowPeriod(period)!);
      if (!graph.ok) throw new Error(graph.reason);
      expect(graph.graph.nodes.find((n) => n.id === "net")?.signedAmount).toBe(source.base);
      expect(graph.graph.nodes.find((n) => n.id === "common-net")).toMatchObject({
        signedAmount: source.common,
        label: "Net loss to common shareholders"
      });
      expect(period.shareholderBridge!.allocations[0].tag).toBe(
        source.key === "FSigned"
          ? "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest"
          : "us-gaap:ConvertiblePreferredDividendsNetOfTax"
      );
      if (source.key === "HPESigned") {
        expect(period.shareholderBridge!.base.tag).toBe(
          "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted"
        );
        expect(period.shareholderBridge!.base.corroboratingTag).toBe("us-gaap:NetIncomeLoss");
        expect(period.metricSources.netIncome!.tag).toBe("us-gaap:NetIncomeLoss");
      } else expect(period.metricSources.netIncome!.tag).toBe("us-gaap:ProfitLoss");
      const revenueOnly = structuredClone(basic);
      revenueOnly.metrics = { revenue: period.metrics.revenue };
      revenueOnly.metricSources = { revenue: period.metricSources.revenue };
      revenueOnly.coverage = { basics: true, segments: false, sankey: false };
      const fresh = readGenericFiling(html, identity, filing, {
        ...company,
        [period.kind]: [revenueOnly]
      }).find((p) => p.id === period.id)!;
      expect(fresh.shareholderBridge).toEqual(period.shareholderBridge);
      expect(fresh.coverage).toEqual({ basics: true, segments: true, sankey: true });
      const incomplete = structuredClone(period);
      delete incomplete.shareholderBridge;
      delete incomplete.metrics.totalOperatingCosts;
      delete incomplete.metrics.grossProfit;
      delete incomplete.metrics.operatingExpenses;
      expect(enrichShareholderPeriods(html, identity, filing, [incomplete])).toEqual([]);
      for (const node of graph.graph.nodes)
        for (const direction of ["source", "target"] as const) {
          const links = graph.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(links.reduce((sum, l) => sum + l.value, 0)).toBeCloseTo(node.amount, 5);
        }
      for (const change of ["amount", "source", "tag", "scope"] as const) {
        const altered = structuredClone(period);
        if (change === "amount") altered.shareholderBridge!.common.amount += 1e6;
        if (change === "source") altered.shareholderBridge!.accession = "0000000000-26-000000";
        if (change === "tag")
          altered.shareholderBridge!.allocations[0].tag = "hpe:UnreviewedDividend";
        if (change === "scope")
          altered.shareholderBridge!.base.scope =
            source.scope === "parent" ? "consolidated" : "parent";
        expect(flowPeriod(altered)).toBeUndefined();
      }
      if (source.key === "HPESigned") {
        const altered = structuredClone(period);
        delete altered.shareholderBridge!.base.corroboratingTag;
        expect(flowPeriod(altered)).toBeUndefined();
      }
    });
  }
  for (const key of ["INTCSigned", "BDXSigned"] as const)
    it(`${key}: routes cost details and source rounding without intersecting unrelated bars`, () => {
      const { period, company } = reviewedFixture(key);
      validateV2(company);
      const result = buildStatementFlow(flowPeriod(period)!);
      if (!result.ok) throw new Error(result.reason);
      expect(result.graph.signedAccounting).toBe(true);
      const layout = layoutStatementFlow(result.graph);
      if (key === "INTCSigned") {
        expect(period.metrics.pretaxIncome).toBe(-10819e6);
        expect(period.metrics.netIncome).toBe(-11033e6);
        expect(period.operatingExpenseDetails).toHaveLength(3);
      } else expect(period.operatingReconciliation?.amount).toBe(-1e6);
      for (const link of layout.links) {
        const v = link.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
        const cubic = (a: number, b: number, c: number, d: number, t: number) =>
          (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
        for (const unrelated of layout.nodes) {
          if (unrelated.id === link.source || unrelated.id === link.target) continue;
          for (let step = 1; step < 400; step++) {
            const t = step / 400;
            const x = cubic(v[0], v[2], v[4], v[6], t);
            if (x < unrelated.x || x > unrelated.x + layout.nodeWidth) continue;
            const y = cubic(v[1], v[3], v[5], v[7], t);
            const overlap =
              Math.min(y + link.width, unrelated.y + unrelated.height) - Math.max(y, unrelated.y);
            expect(
              overlap,
              `${link.source}→${link.target} crosses ${unrelated.id}`
            ).toBeLessThanOrEqual(1e-6);
          }
        }
      }
    });
  for (const key of Object.keys(cases) as (keyof typeof cases)[]) {
    it(`${key}: preserves source-derived loss stages, business proportions and every node balance`, () => {
      const { period, company, basic, html, identity, filing } = reviewedFixture(key);
      const expected = cases[key];
      expect(period.metrics).toMatchObject(expected);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      validateV2(company);
      expect(businessPeriod(period)).toBeDefined();
      const fromRevenueOnly = structuredClone(basic);
      fromRevenueOnly.metrics = { revenue: period.metrics.revenue };
      fromRevenueOnly.metricSources = { revenue: period.metricSources.revenue };
      fromRevenueOnly.coverage = { basics: true, segments: false, sankey: false };
      const recovered = readGenericFiling(html, identity, filing, {
        ...company,
        annual: [fromRevenueOnly]
      }).find((p) => p.id === period.id)!;
      expect(recovered.metrics).toMatchObject(expected);
      expect(recovered.coverage).toEqual(period.coverage);
      const result = buildStatementFlow(flowPeriod(period)!);
      if (!result.ok) throw new Error(result.reason);
      expect(result.graph.signedAccounting).toBe(true);
      const layout = layoutStatementFlow(result.graph);
      const tolerance = accountingTolerance(expected.revenue);
      for (const node of layout.nodes) {
        expect(node.amount).toBeGreaterThanOrEqual(0);
        expect(node.height / node.amount).toBeCloseTo(layout.scale, 12);
        for (const direction of ["source", "target"] as const) {
          const links = result.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(
              Math.abs(links.reduce((sum, l) => sum + l.value, 0) - node.amount)
            ).toBeLessThanOrEqual(tolerance);
        }
        if (node.group === "segment") {
          const business = period.segments!.find((s) => `segment-${s.id}` === node.id)!;
          expect(node.amount).toBe(business.revenue);
          expect(node.height / layout.nodes.find((n) => n.id === "revenue")!.height).toBeCloseTo(
            business.revenue / expected.revenue,
            12
          );
        }
      }
      for (const [id, amount] of [
        ["operating", expected.operatingIncome],
        ["pretax", expected.pretaxIncome],
        ["net", expected.netIncome]
      ] as const) {
        const node = result.graph.nodes.find((n) => n.id === id)!;
        expect(node.signedAmount).toBe(amount);
        expect(node.amount).toBe(Math.abs(amount));
        expect(node.tone).toBe(amount < 0 ? "expense" : "profit");
      }
      for (const link of layout.links) {
        expect(link.value).toBeGreaterThan(0);
        expect(link.width / link.value).toBeCloseTo(layout.scale, 12);
        expect(link.path).not.toMatch(/NaN|Infinity/);
        const v = link.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
        expect(v[9] - v[7]).toBeCloseTo(link.width, 10);
        expect(v[15] - v[1]).toBeCloseTo(link.width, 10);
        const cubic = (a: number, b: number, c: number, d: number, t: number) =>
          (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
        for (const unrelated of layout.nodes) {
          if (unrelated.id === link.source || unrelated.id === link.target) continue;
          for (let step = 1; step < 400; step++) {
            const t = step / 400;
            const x = cubic(v[0], v[2], v[4], v[6], t);
            if (x < unrelated.x || x > unrelated.x + layout.nodeWidth) continue;
            const y = cubic(v[1], v[3], v[5], v[7], t);
            const overlap =
              Math.min(y + link.width, unrelated.y + unrelated.height) - Math.max(y, unrelated.y);
            expect(
              overlap,
              `${link.source}→${link.target} crosses unrelated ${unrelated.id}`
            ).toBeLessThanOrEqual(1e-6);
          }
        }
      }
      expect(result.graph.nodes.find((n) => n.id === "operating")!.label).toBe("Operating loss");
      if (key === "MRNASigned") {
        expect(result.graph.nodes.find((n) => n.id === "net")!.label).toBe("Net loss");
        expect(result.graph.nodes.some((n) => n.id === "gross")).toBe(false);
        expect(period.operatingCostDetails?.map((l) => l.amount)).toEqual([868e6, 3132e6, 1018e6]);
      } else {
        expect(result.graph.nodes.find((n) => n.id === "tax-benefit")).toMatchObject({
          amount: 105682e3,
          signedAmount: -105682e3,
          tone: "profit"
        });
        expect(period.operatingExpenseDetails?.map((l) => l.amount)).toEqual([1035893e3, 684308e3]);
      }
    });

    it(`${key}: withholds corrupt business and signed accounting amounts`, () => {
      const { period } = reviewedFixture(key);
      for (const metric of ["pretaxIncome", "netIncome", "incomeTax"] as const) {
        const changed = structuredClone(period);
        changed.metrics[metric]! += 1e6;
        expect(flowPeriod(changed)).toBeUndefined();
      }
      const changed = structuredClone(period);
      changed.segments![0].revenue += 1e6;
      expect(businessPeriod(changed)).toBeUndefined();
      expect(flowPeriod(changed)).toBeUndefined();
    });
  }
});
