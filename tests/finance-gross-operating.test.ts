import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import sources from "./fixtures/finance/gross-operating-sources.json";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { flowPeriod, businessPeriod, validateV2 } from "../scripts/finance/v2-model";
import { grossOperatingItemsProblem } from "../src/features/finance/gross-operating-items";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";

const fixture = (key: string) => reviewedFixture(key as Parameters<typeof reviewedFixture>[0]);

describe("Flex original gross and operating cost ledgers", () => {
  for (const source of sources)
    it(`${source.id}: keeps original cost, restructuring, reversals and declared precision`, () => {
      const { period, basic, html, identity, filing, company } = fixture(source.key);
      expect(basic.coverage.sankey).toBe(false);
      expect(flowPeriod(period)).toBeDefined();
      expect(grossOperatingItemsProblem(period)).toBeUndefined();
      expect(() => validateV2(company)).not.toThrow();
      const proof = period.grossOperatingItems!;
      const lines = [
        proof.revenue,
        proof.cost,
        ...proof.grossCosts,
        proof.grossProfit,
        ...proof.operatingCosts,
        proof.operatingIncome
      ];
      for (const [i, line] of lines.entries()) {
        const original = source.expected[i]!;
        expect(line).toMatchObject({
          label: original.label,
          tag: original.tag,
          amount: original.value,
          decimals: original.decimals,
          rowIndex: original.rowIndex
        });
      }
      expect(proof).toMatchObject({
        sourceUrl: source.sourceUrl,
        accession: source.accession,
        filedAt: source.filedAt,
        startDate: source.startDate,
        endDate: source.endDate,
        tableIndex: 0
      });
      expect(period.metrics.costOfRevenue).toBe(source.expected[1]!.value);
      expect(period.grossProfitAdjustments).toEqual([
        {
          label: source.expected[2]!.label,
          amount: -source.expected[2]!.value,
          sourceUrl: source.sourceUrl
        }
      ]);
      const originalExpenseSum = proof.operatingCosts.reduce((sum, l) => sum + l.amount, 0);
      expect(period.metrics.operatingExpenses).toBe(originalExpenseSum);
      const originalTax = source.expected.find((l) => l.tag === "us-gaap:IncomeTaxExpenseBenefit")!;
      const taxIndex = source.expected.indexOf(originalTax);
      expect(period.metrics.pretaxIncome).toBe(source.expected[taxIndex - 1]!.value);
      expect(period.metricSources.pretaxIncome?.tag).toBe(source.expected[taxIndex - 1]!.tag);
      expect(period.metrics.incomeTax).toBe(originalTax.value);
      const parent =
        source.expected.find((l) => l.tag === "us-gaap:NetIncomeLoss") ??
        source.expected.find((l) => l.tag === "us-gaap:ProfitLoss")!;
      expect(period.metrics.netIncome).toBe(parent.value);
      const difference =
        proof.operatingIncome.amount - (proof.grossProfit.amount - originalExpenseSum);
      if (Math.abs(difference) > period.metrics.revenue! * 1e-9) {
        expect(period.operatingReconciliation).toMatchObject({
          amount: difference,
          basis: "gross-profit",
          label: "Source rounding"
        });
      } else expect(period.operatingReconciliation).toBeUndefined();
      const result = buildStatementFlow(flowPeriod(period)!);
      if (!result.ok) throw new Error(result.reason);
      const expense = result.graph.nodes.find((n) => n.id === "opex")!;
      expect(expense.amount).toBe(
        proof.operatingCosts.reduce((sum, l) => sum + Math.max(0, l.amount), 0)
      );
      const reversals = result.graph.nodes.filter((n) => n.id.startsWith("operating-reversal-"));
      expect(reversals.map((n) => n.amount)).toEqual(
        proof.operatingCosts.filter((l) => l.amount < 0).map((l) => -l.amount)
      );
      const details = result.graph.nodes.filter((n) => n.id.startsWith("expense-gross-operating-"));
      expect(details.map((n) => n.amount)).toEqual(
        proof.operatingCosts.filter((l) => l.amount > 0).map((l) => l.amount)
      );
      expect(result.graph.nodes.find((n) => n.id.startsWith("gross-cost-"))?.amount).toBe(
        proof.grossCosts[0]!.amount
      );
      for (const node of result.graph.nodes)
        for (const direction of ["source", "target"] as const) {
          const links = result.graph.links.filter((l) => l[direction] === node.id);
          if (links.length)
            expect(
              Math.abs(links.reduce((sum, l) => sum + l.value, 0) - node.amount)
            ).toBeLessThanOrEqual(period.metrics.revenue! * 1e-9);
        }
      if (source.expectedBusiness) {
        expect(businessPeriod(period)).toBeDefined();
        expect(period.segments?.map((s) => s.revenue)).toEqual(
          source.expectedBusiness.slice(0, -1).map((f) => f.value)
        );
        expect(period.segments?.map((s) => s.revenueSource?.dimensions)).toEqual(
          source.expectedBusiness.slice(0, -1).map((f) => f.dimensions)
        );
      }
      if (period.coverage.segments) {
        const layout = layoutStatementFlow(result.graph),
          r = layout.nodes.find((n) => n.id === "revenue")!;
        for (const segment of period.segments!)
          expect(
            layout.nodes.find((n) => n.id === `segment-${segment.id}`)!.height / r.height
          ).toBeCloseTo(segment.revenue / period.metrics.revenue!, 9);
      }
      const first = readGenericFiling(html, identity, filing, undefined, []).find(
        (p) => p.startDate === period.startDate && p.endDate === period.endDate
      );
      // The filing's current duration must work without a previous company.
      if (period.endDate === filing.reportDate) {
        expect(first?.grossOperatingItems).toEqual(proof);
        if (source.expectedBusiness) expect(first?.coverage.segments).toBe(true);
      }
    });

  for (const change of [
    "missing-proof",
    "wrong-rule",
    "wrong-issuer",
    "wrong-accession",
    "wrong-date",
    "wrong-table",
    "missing-precision",
    "changed-cost",
    "changed-stage",
    "unknown-expense",
    "changed-sign",
    "unknown-dimension",
    "reported-source-conflict",
    "calculated-precision",
    "changed-inputs",
    "unknown-gross-line",
    "missing-zero-line",
    "fabricated-rounding",
    "unproved-expense-detail"
  ])
    it(`withholds changed source proof: ${change}`, () => {
      const { period } = fixture(
        change === "missing-zero-line" ? "FLEXGrossOperatingFY2022" : "FLEXGrossOperating2027Q1"
      );
      const p = structuredClone(period),
        proof = p.grossOperatingItems!;
      if (change === "missing-proof") delete p.grossOperatingItems;
      if (change === "wrong-rule") proof.ruleId = "unreviewed-gross-costs";
      if (change === "wrong-issuer")
        proof.sourceUrl = proof.sourceUrl.replace("/866374/", "/1103982/");
      if (change === "wrong-accession") proof.accession = "0000866374-26-000001";
      if (change === "wrong-date") proof.endDate = "2026-06-25";
      if (change === "wrong-table") proof.tableIndex = -1;
      if (change === "missing-precision") delete proof.grossCosts[0]!.decimals;
      if (change === "changed-cost") proof.cost.amount += 1e6;
      if (change === "changed-stage")
        proof.grossCosts[0]!.rowIndex = proof.operatingIncome.rowIndex;
      if (change === "unknown-expense") proof.operatingCosts[1]!.tag = "flex:UnreviewedExpense";
      if (change === "changed-sign") proof.operatingCosts[1]!.amount *= -1;
      if (change === "unknown-dimension")
        proof.cost.dimensions = { "flex:UnreviewedAxis": "flex:OtherMember" };
      if (change === "reported-source-conflict")
        p.metricSources.costOfRevenue!.accession = "0000866374-26-000001";
      if (change === "calculated-precision") p.metricSources.operatingExpenses!.decimals = -6;
      if (change === "changed-inputs")
        p.metricSources.operatingExpenses!.inputs = ["Invented expense total"];
      if (change === "unknown-gross-line") proof.grossCosts[0]!.tag = "flex:UnreviewedGrossCost";
      if (change === "missing-zero-line")
        proof.operatingCosts = proof.operatingCosts.filter((l) => l.amount !== 0);
      if (change === "fabricated-rounding")
        p.operatingReconciliation = {
          label: "Source rounding",
          amount: 1e6,
          basis: "gross-profit",
          sourceUrl: p.sourceUrl
        };
      if (change === "unproved-expense-detail")
        p.operatingExpenseDetails = [
          { id: "manufactured", label: "Expense", amount: p.metrics.operatingExpenses! }
        ];
      expect(flowPeriod(p)).toBeUndefined();
    });

  it("keeps FY2020's primary-table amortization separate from more precise narrative copies", () => {
    const { period, html, identity, filing, basic } = fixture("FLEXGrossOperatingFY2020");
    const narrative = readFileSync(
      new URL("./fixtures/finance/FLEX-FY2020-amortization-narrative.html", import.meta.url),
      "utf8"
    );
    // This unchanged original fragment uses the primary table's same QName and
    // context, but reports 64.1M at a different precision outside that table.
    for (const complete of [narrative + html, html + narrative]) {
      const actual = readGenericFiling(complete, identity, filing, undefined, [basic]).find(
        (p) => p.id === basic.id
      )!;
      expect(actual.grossOperatingItems).toEqual(period.grossOperatingItems);
      expect(actual.metrics.operatingExpenses).toBe(924e6);
      expect(actual.operatingReconciliation).toBeUndefined();
    }
    expect(
      period.grossOperatingItems!.operatingCosts.find(
        (l) => l.tag === "us-gaap:AmortizationOfIntangibleAssets"
      )
    ).toMatchObject({ amount: 64e6, decimals: -6 });
    expect(period.operatingReconciliation).toBeUndefined();
    for (const change of ["remove-precision", "invent-difference"]) {
      const p = structuredClone(period);
      if (change === "remove-precision") delete p.grossOperatingItems!.operatingCosts[1]!.decimals;
      if (change === "invent-difference")
        p.operatingReconciliation = {
          label: "Source rounding",
          amount: 1e5,
          basis: "gross-profit",
          sourceUrl: p.sourceUrl
        };
      expect(flowPeriod(p)).toBeUndefined();
    }
  });

  it("rejects renamed business headings and corporate-scope substitutions", () => {
    const { html, identity, filing, basic, period } = fixture("FLEXGrossOperatingFY2026");
    expect(period.segments?.map((s) => s.label)).toEqual(["ITS", "RMS", "CPI"]);
    const altered = html.replaceAll(">CPI<", ">Unreviewed business<");
    expect(altered).not.toBe(html);
    const parsed = readGenericFiling(altered, identity, filing, undefined, [basic]).find(
      (p) => p.id === basic.id
    );
    expect(parsed?.coverage.sankey).toBe(true);
    expect(parsed?.coverage.segments).toBe(false);
    const p = structuredClone(period);
    p.segments![2]!.revenueSource!.dimensions = {
      "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
    };
    expect(businessPeriod(p)).toBeUndefined();
  });

  it("revalidates an existing calculated ledger from same-filing primary cells on refresh", () => {
    const { period, html, identity, filing } = fixture("FLEXGrossOperatingFY2020");
    const prior = structuredClone(period);
    const proof = prior.grossOperatingItems!;
    proof.operatingCosts[1]!.amount = 64.1 * 1e6;
    proof.operatingCosts[1]!.decimals = -5;
    prior.metrics.operatingExpenses = proof.operatingCosts.reduce((sum, l) => sum + l.amount, 0);
    prior.operatingReconciliation = {
      label: "Source rounding",
      amount:
        proof.operatingIncome.amount - (proof.grossProfit.amount - prior.metrics.operatingExpenses),
      sourceUrl: prior.sourceUrl,
      basis: "gross-profit"
    };
    expect(grossOperatingItemsProblem(prior)).toBeUndefined();
    const actual = readGenericFiling(html, identity, filing, undefined, [prior]).find(
      (p) => p.id === prior.id
    )!;
    expect(actual.grossOperatingItems).toEqual(period.grossOperatingItems);
    expect(actual.metrics).toEqual(period.metrics);
    expect(actual.operatingReconciliation).toBeUndefined();
  });
});
