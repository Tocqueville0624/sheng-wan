import { describe, expect, it } from "vitest";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow, accountingTolerance } from "../src/features/finance/chart-model";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

const cases = [
  ["HSYPrimaryExpensesAnnual", 2481163000, 61655000, [2460569000, 20594000]],
  ["APHPrimaryExpensesAnnual", 2649100000, 647000000, [103400000, 2545700000]],
  ["IEXPrimaryExpensesAnnual", 839500000, 70000000, [818800000, 20700000]]
] as const;

describe("complete original primary expense partitions", () => {
  for (const [key, total, research, amounts] of cases) {
    it(`${key}: uses the original expense lines while preserving independent R&D`, () => {
      const { company, period } = reviewedFixture(key);
      validateV2(company);
      expect(period.metrics.operatingExpenses).toBeCloseTo(total, 5);
      expect(period.metrics.researchAndDevelopment).toBe(research);
      expect(period.operatingExpenseDetails?.map((line) => line.amount)).toEqual(amounts);
      expect(period.operatingExpensesBasis).toBeUndefined();
      const statement = flowPeriod(period);
      if (!statement) throw new Error("Original partition did not validate as a flow.");
      const flow = buildStatementFlow(statement);
      if (!flow.ok) throw new Error(flow.reason);
      expect(
        flow.graph.nodes.filter((node) => node.group === "detail").map((node) => node.amount)
      ).toEqual(amounts);
      expect(
        flow.graph.nodes.some((node) => node.id === "rd" || /research/i.test(node.label))
      ).toBe(false);
      for (const direction of ["source", "target"] as const) {
        for (const node of flow.graph.nodes) {
          const links = flow.graph.links.filter((link) => link[direction] === node.id);
          if (links.length)
            expect(
              Math.abs(links.reduce((sum, link) => sum + link.value, 0) - node.amount)
            ).toBeLessThanOrEqual(accountingTolerance(period.metrics.revenue!));
        }
      }
    });

    it(`${key}: reads the source-current partition on an empty first import`, () => {
      const { html, identity, filing, period } = reviewedFixture(key);
      const first = readGenericFiling(html, identity, filing, undefined).find(
        (p) => p.id === period.id
      );
      expect(first?.coverage.sankey).toBe(true);
      expect(first?.operatingExpenseDetails).toEqual(period.operatingExpenseDetails);
      expect(first?.metrics.revenue).toBe(period.metrics.revenue);
      expect(first?.metrics.operatingIncome).toBe(period.metrics.operatingIncome);
      expect(first?.metrics.netIncome).toBe(period.metrics.netIncome);
    });
  }

  it("retains the original single SG&A expense row in a historical comparative quarter", () => {
    const { company, period } = reviewedFixture("HSYPrimaryExpenses2024Q1");
    validateV2(company);
    expect(period.id).toBe("2024-Q1");
    expect(period.filedAt).toBe("2025-05-01");
    expect(period.operatingExpenseDetails).toHaveLength(1);
    expect(period.operatingExpenseDetails![0].tag).toBe(
      "us-gaap:SellingGeneralAndAdministrativeExpense"
    );
    expect(period.operatingExpenseDetails![0].amount).toBe(period.metrics.operatingExpenses);
    const statement = flowPeriod(period);
    if (!statement) throw new Error("Original single expense row did not validate as a flow.");
    const flow = buildStatementFlow(statement);
    if (!flow.ok) throw new Error(flow.reason);
    expect(flow.graph.nodes.filter((node) => node.group === "detail")).toHaveLength(1);
  });

  it("withholds an altered or duplicated partition and never bypasses missing source detail", () => {
    const { period } = reviewedFixture("HSYPrimaryExpensesAnnual");
    const statement = flowPeriod(period);
    if (!statement) throw new Error("Original partition did not validate as a flow.");
    const missing = structuredClone(statement);
    delete missing.operatingExpenseDetails;
    expect(buildStatementFlow(missing).ok).toBe(false);
    const changed = structuredClone(statement);
    changed.operatingExpenseDetails![0].amount += 1000;
    expect(buildStatementFlow(changed).ok).toBe(false);
    const duplicated = structuredClone(statement);
    duplicated.operatingExpenseDetails![1].id = duplicated.operatingExpenseDetails![0].id;
    expect(buildStatementFlow(duplicated).ok).toBe(false);
  });
});
