import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";
import { directNetItemsProblem } from "../src/features/finance/direct-net-items";

describe("source-reviewed direct net-income statements", () => {
  for (const [key, expected] of [
    [
      "AREDirectNet2017",
      {
        revenue: 1128097e3,
        totalExpenses: 949700e3,
        netIncome: 169093e3,
        consolidated: 194204e3,
        common: 145395e3
      }
    ],
    [
      "AREDirectNet2021Q3",
      {
        revenue: 547759e3,
        totalExpenses: 493066e3,
        netIncome: 103147e3,
        consolidated: 124433e3,
        common: 101264e3
      }
    ],
    [
      "AREDirectNetAnnual",
      {
        revenue: 3026556e3,
        totalExpenses: 4819753e3,
        netIncome: -1429570e3,
        consolidated: -1216726e3,
        common: -1437987e3
      }
    ],
    [
      "AREDirectNetQuarter",
      {
        revenue: 662784e3,
        totalExpenses: 835393e3,
        netIncome: -72783e3,
        consolidated: -38969e3,
        common: -73691e3
      }
    ]
  ] as const) {
    it(`${key}: uses original expenses and gains without inventing tax or pretax income`, () => {
      const { period, company, identity, basic, filing, html } = reviewedFixture(key);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metrics).toMatchObject({
        revenue: expected.revenue,
        totalExpenses: expected.totalExpenses,
        netIncome: expected.netIncome
      });
      const proof = period.directNetItems!;
      expect(proof.consolidated.amount).toBe(expected.consolidated);
      expect(period.shareholderBridge?.common.amount).toBe(expected.common);
      expect(
        period.metrics.revenue! -
          period.metrics.totalExpenses! +
          proof.gains.reduce((sum, item) => sum + item.amount, 0)
      ).toBe(expected.consolidated);
      for (const metric of [
        "incomeTax",
        "pretaxIncome",
        "operatingIncome",
        "grossProfit",
        "totalOperatingCosts",
        "equityMethodIncome"
      ] as const)
        expect(period.metrics[metric]).toBeUndefined();
      expect(period.metricSources.totalOperatingCosts).toBeUndefined();
      expect(period.metricSources.totalExpenses?.method).toBe("reported");
      expect(businessPeriod(period)?.segments).toHaveLength(2);
      expect(directNetItemsProblem(period)).toBeUndefined();
      validateV2(company);
      const result = buildStatementFlow(flowPeriod(period)!);
      if (!result.ok) throw new Error(result.reason);
      expect(result.graph.nodes.some((n) => ["operating", "pretax", "tax"].includes(n.id))).toBe(
        false
      );
      expect(result.graph.nodes.find((n) => n.id === "consolidated-net")?.signedAmount).toBe(
        expected.consolidated
      );
      expect(result.graph.nodes.find((n) => n.id === "common-net")?.signedAmount).toBe(
        expected.common
      );
      for (const node of result.graph.nodes)
        for (const direction of ["source", "target"] as const) {
          const links = result.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(links.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(node.amount, 5);
        }
      const layout = layoutStatementFlow(result.graph),
        revenueHeight = layout.nodes.find((n) => n.id === "revenue")!.height;
      for (const segment of period.segments!)
        expect(
          layout.nodes.find((n) => n.id === `segment-${segment.id}`)!.height / revenueHeight
        ).toBeCloseTo(segment.revenue / period.metrics.revenue!, 10);
      const seed = structuredClone(basic);
      seed.metrics = { revenue: period.metrics.revenue };
      seed.metricSources = { revenue: basic.metricSources.revenue };
      const recovered = readGenericFiling(html, identity, filing, {
        ...company,
        [period.kind]: [seed]
      }).find((p) => p.id === period.id)!;
      expect(recovered.metrics).toEqual(period.metrics);
      expect(recovered.directNetItems).toEqual(proof);
      expect(recovered.shareholderBridge).toEqual(period.shareholderBridge);
      if (key === "AREDirectNetAnnual")
        expect(
          proof.expenseItems.find((l) => l.tag === "us-gaap:GainsLossesOnExtinguishmentOfDebt")
        ).toMatchObject({ amount: -107e3, effect: "gain" });
      else if (key === "AREDirectNetQuarter")
        expect(proof.gains.filter((l) => l.amount === 0)).toHaveLength(2);
    });
  }

  for (const change of [
    "expense",
    "gain",
    "nci",
    "scope",
    "date",
    "source",
    "order",
    "missing-row",
    "concept",
    "precision",
    "invented-tax",
    "cost-scope",
    "rule"
  ] as const)
    it(`withholds a direct net-income ledger with changed ${change}`, () => {
      const { period, company } = reviewedFixture("AREDirectNetAnnual");
      const p = structuredClone(period),
        proof = p.directNetItems!;
      if (change === "expense") proof.expenses.amount += 1e6;
      if (change === "gain") proof.gains[0].amount += 1e6;
      if (change === "nci") proof.noncontrolling.amount *= -1;
      if (change === "scope")
        proof.revenue.dimensions = { "srt:ProductOrServiceAxis": "are:IncomeFromRentalsMember" };
      if (change === "date") proof.startDate = "2024-01-01";
      if (change === "source") proof.sourceUrl = proof.sourceUrl.replace("/1035443/", "/2969/");
      if (change === "order") proof.gains.reverse();
      if (change === "missing-row") proof.expenseItems.pop();
      if (change === "concept") proof.gains[0].tag = "are:UnreviewedGain";
      if (change === "precision") delete proof.expenses.decimals;
      if (change === "invented-tax") p.metrics.incomeTax = 0;
      if (change === "cost-scope") p.metrics.totalOperatingCosts = proof.expenses.amount;
      if (change === "rule") proof.ruleId = "unreviewed-direct-net";
      expect(directNetItemsProblem(p)).toBeTruthy();
      expect(flowPeriod(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeTruthy();
      expect(() => validateV2({ ...company, annual: [p] })).toThrow();
    });

  for (const concept of ["us-gaap:InterestExpense", "us-gaap:EquitySecuritiesFvNiGainLoss"])
    it(`retains business revenue independently when ${concept} changes`, () => {
      const { html, identity, filing, company, basic } = reviewedFixture("AREDirectNetQuarter");
      const changed = html.replaceAll(`name="${concept}"`, 'name="are:UnreviewedStatementItem"');
      expect(changed).not.toBe(html);
      const period = readGenericFiling(changed, identity, filing, {
        ...company,
        quarterly: [basic]
      }).find((p) => p.id === basic.id)!;
      expect(period.directNetItems).toBeUndefined();
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: false });
      validateV2({ ...company, quarterly: [period] });
    });
});
