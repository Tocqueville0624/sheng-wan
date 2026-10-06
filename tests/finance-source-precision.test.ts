import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";

const cases = {
  GEHC2024Q2: {
    id: "2024-Q2",
    revenue: 4839e6,
    gross: 2002e6,
    expenses: 1395e6,
    operating: 608e6,
    net: 428e6
  },
  GEHC2024Q3: {
    id: "2024-Q3",
    revenue: 4863e6,
    gross: 2026e6,
    expenses: 1350e6,
    operating: 676e6,
    net: 470e6
  },
  GEHC2025Q1: {
    id: "2025-Q1",
    revenue: 4777e6,
    gross: 2012e6,
    expenses: 1383e6,
    operating: 629e6,
    net: 564e6
  },
  GEHC2026Q2: {
    id: "2026-Q2",
    revenue: 5295e6,
    gross: 2180e6,
    expenses: 1441e6,
    operating: 739e6,
    net: 561e6
  }
};

describe("declared source precision at distinct statement stages", () => {
  it("preserves positive after-tax rounding alongside the reported minority loss", () => {
    const { period, company } = reviewedFixture("CMCSAPrecision");
    validateV2(company);
    expect(period.metrics).toMatchObject({
      revenue: 29940e6,
      pretaxIncome: 4612e6,
      incomeTax: 1194e6,
      netIncome: 3526e6,
      noncontrollingInterestIncome: -107e6
    });
    expect(period.afterTaxReconciliation?.amount).toBe(1e6);
    expect(period.consolidatedIncomeSubtotal?.amount).toBe(3419e6);
    const result = buildStatementFlow(flowPeriod(period)!);
    if (!result.ok) throw new Error(result.reason);
    expect(result.graph.nodes.find((n) => n.id === "after-tax-rounding")).toMatchObject({
      tone: "profit",
      amount: 1e6
    });
    for (const node of result.graph.nodes) {
      const incoming = result.graph.links.filter((l) => l.target === node.id);
      const outgoing = result.graph.links.filter((l) => l.source === node.id);
      if (incoming.length) expect(incoming.reduce((sum, l) => sum + l.value, 0)).toBe(node.amount);
      if (outgoing.length) expect(outgoing.reduce((sum, l) => sum + l.value, 0)).toBe(node.amount);
    }
  });
  for (const key of Object.keys(cases) as (keyof typeof cases)[]) {
    it(`${key}: preserves every reported subtotal and conserves every drawn node`, () => {
      const { period, company } = reviewedFixture(key);
      const expected = cases[key];
      expect(period.id).toBe(expected.id);
      expect(period.metrics).toMatchObject({
        revenue: expected.revenue,
        grossProfit: expected.gross,
        operatingExpenses: expected.expenses,
        operatingIncome: expected.operating,
        netIncome: expected.net
      });
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metricSources.operatingExpenses?.method).toBe("reported");
      validateV2(company);
      const result = buildStatementFlow(flowPeriod(period)!);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      for (const node of result.graph.nodes) {
        const incoming = result.graph.links.filter((link) => link.target === node.id);
        const outgoing = result.graph.links.filter((link) => link.source === node.id);
        if (incoming.length)
          expect(incoming.reduce((sum, link) => sum + link.value, 0)).toBe(node.amount);
        if (outgoing.length)
          expect(outgoing.reduce((sum, link) => sum + link.value, 0)).toBe(node.amount);
      }
      const layout = layoutStatementFlow(result.graph);
      const scale = layout.nodes.find((node) => node.id === "revenue")!.height / expected.revenue;
      for (const node of layout.nodes) expect(node.height).toBeCloseTo(node.amount * scale, 9);
      if (key === "GEHC2024Q2") {
        expect(period.operatingReconciliation).toMatchObject({
          amount: 1e6,
          basis: "gross-profit"
        });
        expect(period.roundedOperatingExpenseComponents?.difference).toBe(1e6);
      }
      if (key === "GEHC2024Q3") expect(period.afterTaxReconciliation?.amount).toBe(-1e6);
      if (key === "GEHC2025Q1") {
        expect(period.roundedOperatingExpenseComponents?.difference).toBe(-1e6);
        expect(period.metrics.researchAndDevelopment).toBe(344e6);
        expect(period.metrics.sellingGeneralAndAdministrative).toBe(1040e6);
      }
      if (period.roundedOperatingExpenseComponents)
        expect(
          result.graph.nodes.some((node) => ["rd", "sga", "other-opex"].includes(node.id))
        ).toBe(false);
      if (key === "GEHC2026Q2") {
        expect(period.consolidatedIncomeSubtotal).toMatchObject({
          amount: 573e6,
          tag: "us-gaap:ProfitLoss",
          decimals: -6
        });
        expect(period.metrics.pretaxIncome! - period.metrics.incomeTax!).toBe(574e6);
        expect(period.afterTaxReconciliation).toBeUndefined();
      }
    });
  }

  it("withholds changed precision, foreign provenance and excessive rounding instead of loosening identities", () => {
    for (const key of Object.keys(cases) as (keyof typeof cases)[]) {
      const { period } = reviewedFixture(key);
      const invalid = structuredClone(period);
      const sourceKey =
        key === "GEHC2024Q2" || key === "GEHC2025Q1" ? "operatingExpenses" : "incomeTax";
      delete invalid.metricSources[sourceKey]!.decimals;
      expect(flowPeriod(invalid)).toBeUndefined();
      invalid.metricSources[sourceKey] = {
        ...period.metricSources[sourceKey]!,
        sourceUrl: "https://www.sec.gov/other.htm"
      };
      expect(flowPeriod(invalid)).toBeUndefined();
      const excessive = structuredClone(period);
      if (excessive.operatingReconciliation) excessive.operatingReconciliation.amount = 100e6;
      else if (excessive.afterTaxReconciliation) excessive.afterTaxReconciliation.amount = -100e6;
      else if (excessive.consolidatedIncomeSubtotal)
        excessive.consolidatedIncomeSubtotal.amount += 100e6;
      else excessive.roundedOperatingExpenseComponents!.difference -= 100e6;
      expect(flowPeriod(excessive)).toBeUndefined();
    }
  });

  it("rejects changed intermediate scope, component amount and an unproved expense-suppression flag", () => {
    const intermediate = reviewedFixture("GEHC2026Q2").period;
    intermediate.consolidatedIncomeSubtotal!.tag = "gehc:UnreviewedIncome";
    expect(flowPeriod(intermediate)).toBeUndefined();
    const components = reviewedFixture("GEHC2025Q1").period;
    components.roundedOperatingExpenseComponents!.components[0].amount += 1;
    expect(flowPeriod(components)).toBeUndefined();
    const { period } = reviewedFixture("GEHC2024Q2");
    delete period.operatingReconciliation!.basis;
    expect(flowPeriod(period)).toBeUndefined();
  });

  it("does not accept an unknown or high-precision intermediate subtotal in original source rows", () => {
    const source = reviewedFixture("GEHC2026Q2");
    for (const html of [
      source.html.replaceAll('name="us-gaap:ProfitLoss"', 'name="gehc:UnreviewedIncome"'),
      source.html.replaceAll('decimals="-6"', 'decimals="0"')
    ]) {
      const result = readGenericFiling(html, source.identity, source.filing, undefined);
      expect(result.find((p) => p.id === cases.GEHC2026Q2.id)?.coverage.sankey).not.toBe(true);
    }
  });
});
