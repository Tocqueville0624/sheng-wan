import { describe, expect, it } from "vitest";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { currentFilingCandidates } from "../scripts/finance/current-filing";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { enrichStatementPeriods } from "../scripts/finance/statement-v2";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow } from "../src/features/finance/chart-model";

const expected = {
  KO: {
    revenue: 13380e6,
    grossProfit: 8415e6,
    costOfRevenue: 4965e6,
    operatingExpenses: 3743e6,
    operatingIncome: 4672e6,
    pretaxIncome: 5475e6,
    incomeTax: 1037e6,
    netIncome: 4425e6,
    noncontrollingInterestIncome: 13e6
  },
  GRMN: {
    revenue: 2022092e3,
    grossProfit: 1262022e3,
    costOfRevenue: 760070e3,
    operatingExpenses: 646514e3,
    operatingIncome: 615508e3,
    pretaxIncome: 651061e3,
    incomeTax: 109141e3,
    netIncome: 541920e3
  },
  LII: {
    revenue: 1545.3e6,
    grossProfit: 539.5e6,
    costOfRevenue: 1005.8e6,
    operatingExpenses: 184.5e6,
    operatingIncome: 355e6,
    pretaxIncome: 339.6e6,
    incomeTax: 70.6e6,
    netIncome: 269e6
  },
  MAS: {
    revenue: 1992e6,
    grossProfit: 868e6,
    costOfRevenue: 1124e6,
    operatingExpenses: 398e6,
    operatingIncome: 470e6,
    pretaxIncome: 440e6,
    incomeTax: 107e6,
    netIncome: 318e6,
    noncontrollingInterestIncome: 15e6
  },
  VLTO: {
    revenue: 1474e6,
    grossProfit: 902e6,
    costOfRevenue: 572e6,
    operatingExpenses: 587e6,
    operatingIncome: 315e6,
    pretaxIncome: 289e6,
    incomeTax: 48e6,
    netIncome: 241e6
  }
};

describe("reported gross-profit statements with Company Facts lag", () => {
  for (const ticker of Object.keys(expected) as (keyof typeof expected)[]) {
    it(`${ticker}: first source import completes the flow and retains business revenue`, () => {
      const source = reviewedFixture(ticker);
      const seed = currentFilingCandidates(
        source.identity,
        source.filing,
        parseInlineXbrl(source.html),
        []
      )[0];
      expect(seed.metrics).toEqual({ revenue: expected[ticker].revenue });
      const before = structuredClone(seed);
      const period = readGenericFiling(source.html, source.identity, source.filing, undefined).find(
        (p) => p.id === seed.id
      )!;
      expect(period.metrics).toMatchObject(expected[ticker]);
      expect(period.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(period.metricSources.grossProfit).toMatchObject({
        method: "reported",
        tag: "us-gaap:GrossProfit",
        sourceUrl: source.filing.sourceUrl
      });
      expect(period.segments?.map((s) => [s.label, s.revenue])).toEqual(
        source.period.segments?.map((s) => [s.label, s.revenue])
      );
      expect(period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(period.metrics.revenue);
      const flow = flowPeriod(period)!;
      expect(buildStatementFlow(flow).ok).toBe(true);
      validateV2({ ...source.company, quarterly: [period] });
      expect(seed).toEqual(before);
      if (ticker === "LII" || ticker === "MAS") {
        expect(period.operatingExpensesBasis).toBe("expenses-and-other-items-net");
        expect(period.operatingExpenseDetails).toBeUndefined();
        expect(period.metricSources.operatingExpenses).toMatchObject({
          method: "calculated",
          inputs: [
            expect.stringContaining("us-gaap:GrossProfit"),
            expect.stringContaining("us-gaap:OperatingIncomeLoss")
          ]
        });
        const built = buildStatementFlow(flow);
        if (!built.ok) throw new Error(built.reason);
        expect(built.graph.nodes.find((n) => n.id === "opex")?.label).toBe(
          "Operating expenses and other items (net)"
        );
        expect(built.graph.nodes.some((n) => ["other-opex", "sga", "rd"].includes(n.id))).toBe(
          false
        );
      } else {
        expect(period.operatingExpensesBasis).toBeUndefined();
        expect(period.operatingExpenseDetails?.reduce((sum, d) => sum + d.amount, 0)).toBe(
          period.metrics.operatingExpenses
        );
      }
      if (ticker === "GRMN")
        expect(period.metricSources.operatingExpenses?.method).toBe("reported");
    });
  }

  it("withholds gross-stage recovery when a source gross fact is missing, conflicting or dimensional", () => {
    const { identity, filing, html } = reviewedFixture("KO");
    const seed = currentFilingCandidates(identity, filing, parseInlineXbrl(html), [])[0];
    const parsed = parseInlineXbrl(html);
    for (const scenario of ["missing", "conflict", "dimensional"] as const) {
      const changed = structuredClone(parsed);
      const target = changed.facts.filter(
        (f) =>
          f.tag === "us-gaap:GrossProfit" &&
          f.context.start === seed.startDate &&
          f.context.end === seed.endDate
      );
      if (scenario === "missing") changed.facts = changed.facts.filter((f) => !target.includes(f));
      if (scenario === "conflict")
        changed.facts.push({ ...target[0], value: target[0].value + 1e6 });
      if (scenario === "dimensional")
        target.forEach((f) => (f.context.dimensions = { "srt:GeographicalAxis": "test:USMember" }));
      // A valid direct flow can still use the independent reported cost rows;
      // an unavailable/ambiguous gross fact must never become a derived gross stage.
      for (const period of enrichStatementPeriods(html, identity, filing, [seed], changed)) {
        expect(period.metrics.grossProfit).toBeUndefined();
        expect(period.metricSources.grossProfit).toBeUndefined();
      }
    }
    expect(
      enrichStatementPeriods(html, identity, filing, [
        {
          ...seed,
          metrics: { ...seed.metrics, costOfRevenue: 4000e6 },
          metricSources: {
            ...seed.metricSources,
            costOfRevenue: {
              ...seed.metricSources.revenue!,
              tag: "us-gaap:CostOfGoodsAndServicesSold"
            }
          }
        }
      ])
    ).toEqual([]);
  });

  it("calculates a missing cost total only from directly reported revenue and gross profit", () => {
    const { identity, filing, html } = reviewedFixture("KO");
    const parsed = parseInlineXbrl(html);
    const seed = currentFilingCandidates(identity, filing, parsed, [])[0];
    parsed.facts = parsed.facts.filter((f) => f.tag !== "us-gaap:CostOfGoodsAndServicesSold");
    const period = enrichStatementPeriods(html, identity, filing, [seed], parsed)[0];
    expect(period.metrics.costOfRevenue).toBe(4965e6);
    expect(period.metricSources.costOfRevenue).toMatchObject({
      method: "calculated",
      tag: "us-gaap:Revenues - us-gaap:GrossProfit",
      inputs: [
        expect.stringContaining("us-gaap:Revenues"),
        expect.stringContaining("us-gaap:GrossProfit")
      ]
    });
    expect(period.metricSources.grossProfit?.method).toBe("reported");
    expect(flowPeriod(period)).toBeDefined();
  });

  it("rejects a net-cost scope with an invented expense split or reported provenance", () => {
    const { period } = reviewedFixture("LII");
    expect(
      flowPeriod({
        ...period,
        operatingExpenseDetails: [
          {
            id: "invented",
            label: "Other expenses",
            tag: "test:Other",
            amount: period.metrics.operatingExpenses!
          }
        ]
      })
    ).toBeUndefined();
    expect(
      flowPeriod({
        ...period,
        metricSources: {
          ...period.metricSources,
          operatingExpenses: { ...period.metricSources.operatingExpenses!, method: "reported" }
        }
      })
    ).toBeUndefined();
  });
});
