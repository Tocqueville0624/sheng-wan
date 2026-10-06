import { describe, it, expect } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import sources from "./fixtures/finance/after-tax-transaction-sources.json";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichStatementPeriods } from "../scripts/finance/statement-v2";
import { flowPeriod, businessPeriod } from "../scripts/finance/v2-model";
import {
  afterTaxTransactionItemsProblem,
  afterTaxTransactionRule
} from "../src/features/finance/after-tax-transaction";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";

const fixture = (key: string) => reviewedFixture(key as Parameters<typeof reviewedFixture>[0]);

describe("original Mondelez after-tax transaction chain", () => {
  for (const source of sources)
    it(`${source.id}: preserves every original sign and separate equity income`, () => {
      const { period, basic, identity, filing, html } = fixture(source.key);
      expect(basic.coverage.sankey).toBe(false);
      expect(period.coverage).toMatchObject({ sankey: true, segments: true });
      expect(flowPeriod(period)).toBeDefined();
      expect(businessPeriod(period)).toBeDefined();
      expect(afterTaxTransactionItemsProblem(period)).toBeUndefined();
      const proof = period.afterTaxTransactionItems!;
      expect(proof).toMatchObject({
        ruleId: afterTaxTransactionRule.id,
        sourceUrl: source.sourceUrl,
        accession: source.accession,
        filedAt: source.filedAt,
        startDate: source.startDate,
        endDate: source.endDate,
        tableIndex: 0
      });
      const lines = [
        proof.pretax,
        proof.tax,
        proof.transaction,
        proof.equity,
        proof.consolidated,
        proof.noncontrolling,
        proof.parent
      ];
      for (const [i, expected] of source.expected.entries()) {
        expect(lines[i]).toMatchObject({
          tag: expected.tag,
          label: expected.label,
          amount: expected.value,
          rowIndex: expected.rowIndex,
          decimals: expected.decimals
        });
      }
      expect(period.metrics.afterTaxTransactionIncome).toBe(proof.transaction.amount);
      expect(period.metrics.equityMethodIncome).toBe(proof.equity.amount);
      expect(period.metrics.netIncome).toBe(proof.parent.amount);
      expect(period.metricSources.afterTaxTransactionIncome).toMatchObject({
        tag: source.expected[2].tag,
        method: "reported",
        sourceUrl: source.sourceUrl,
        decimals: -6
      });
      expect(period.afterTaxReconciliation).toBeUndefined();
      expect(period.metrics.afterTaxSubsidiaryIncome).toBeUndefined();
      expect(period.metrics.discontinuedOperationsIncome).toBeUndefined();
      const graph = buildStatementFlow(flowPeriod(period)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw new Error(graph.reason);
      expect(graph.graph.signedAccounting).toBe(true);
      const node = graph.graph.nodes.find((n) => n.id === "after-tax-transaction");
      if (proof.transaction.amount !== 0) {
        expect(node?.signedAmount).toBe(proof.transaction.amount);
        expect(node?.amount).toBe(Math.abs(proof.transaction.amount));
        expect(node?.label).toContain(proof.transaction.amount < 0 ? "loss" : "gain");
      } else expect(node).toBeUndefined();
      const layout = layoutStatementFlow(graph.graph);
      const revenue = layout.nodes.find((n) => n.id === "revenue")!;
      for (const segment of period.segments!) {
        const bar = layout.nodes.find((n) => n.id === `segment-${segment.id}`)!;
        expect(bar.height / revenue.height).toBeCloseTo(
          segment.revenue / period.metrics.revenue!,
          9
        );
      }
      const changed = readGenericFiling(html, identity, filing, undefined, [basic]);
      expect(changed.find((p) => p.id === period.id)?.afterTaxTransactionItems).toEqual(proof);
    });

  for (const change of [
    "missing-proof",
    "wrong-rule",
    "wrong-issuer",
    "wrong-filing",
    "wrong-date",
    "typed-scope",
    "changed-concept",
    "missing-precision",
    "changed-amount",
    "double-sign",
    "wrong-stage",
    "metric-conflict",
    "metric-source-conflict",
    "tax-residual",
    "other-after-tax-income",
    "swapped-equity",
    "lost-zero"
  ])
    it(`withholds altered after-tax proof: ${change}`, () => {
      const { period } = fixture(
        change === "lost-zero" ? "MDLZTransaction2026Q2" : "MDLZTransactionFY2024"
      );
      const p = structuredClone(period);
      const proof = p.afterTaxTransactionItems!;
      if (change === "missing-proof") delete p.afterTaxTransactionItems;
      if (change === "wrong-rule") proof.ruleId = "unknown-issuer";
      if (change === "wrong-issuer") {
        proof.sourceUrl = proof.sourceUrl.replace("/1103982/", "/63908/");
        p.sourceUrl = proof.sourceUrl;
      }
      if (change === "wrong-filing") proof.accession = "0001103982-26-000001";
      if (change === "wrong-date") proof.startDate = "2024-01-02";
      if (change === "typed-scope")
        proof.transaction.dimensions = { "mdlz:BusinessAxis": "mdlz:OtherMember" };
      if (change === "changed-concept") proof.transaction.tag = "mdlz:UnknownTransaction";
      if (change === "missing-precision") delete proof.transaction.decimals;
      if (change === "changed-amount") proof.transaction.amount += 1e6;
      if (change === "double-sign") {
        proof.transaction.amount *= -1;
        p.metrics.afterTaxTransactionIncome = proof.transaction.amount;
      }
      if (change === "wrong-stage") proof.transaction.rowIndex = proof.tax.rowIndex - 1;
      if (change === "metric-conflict") p.metrics.equityMethodIncome! += 1e6;
      if (change === "metric-source-conflict")
        p.metricSources.afterTaxTransactionIncome!.method = "calculated";
      if (change === "tax-residual")
        p.afterTaxReconciliation = { label: "Source rounding", amount: 1, sourceUrl: p.sourceUrl };
      if (change === "other-after-tax-income") p.metrics.afterTaxSubsidiaryIncome = 1;
      if (change === "swapped-equity") {
        const previous = proof.transaction.rowIndex;
        proof.transaction.rowIndex = proof.equity.rowIndex;
        proof.equity.rowIndex = previous;
      }
      if (change === "lost-zero") delete p.metrics.afterTaxTransactionIncome;
      expect(afterTaxTransactionItemsProblem(p)).toBeDefined();
      expect(flowPeriod(p)).toBeUndefined();
      expect(buildStatementFlow(p as Parameters<typeof buildStatementFlow>[0]).ok).toBe(false);
    });

  it("rejects original-table concept and sign changes without balancing net income", () => {
    const { basic, html, identity, filing } = fixture("MDLZTransaction2026Q1");
    expect(
      enrichStatementPeriods(
        html.replaceAll(afterTaxTransactionRule.tags.transaction, "mdlz:UnreviewedAfterTaxItem"),
        identity,
        filing,
        [basic]
      )
    ).toEqual([]);
    const negated = html.replace(
      /<ix:nonFraction\b[^>]*name="mdlz:EquityMethodInvestmentRealizedGainLossOnTransaction"[^>]*>/gi,
      (opening) => opening.replace(/\ssign="-"/, "")
    );
    expect(negated).not.toBe(html);
    expect(enrichStatementPeriods(negated, identity, filing, [basic])).toEqual([]);
  });
});
