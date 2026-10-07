import { describe, expect, it } from "vitest";
import {
  standaloneBusinessFixture,
  sourceOnlyBusinessFixture
} from "./fixtures/finance/standalone-business-fixtures";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import { grossOperatingItemsProblem } from "../src/features/finance/gross-operating-items";
import type { PeriodV2 } from "../src/features/finance/v2-types";

describe("original Albemarle primary income stages", () => {
  it.each(["preserved", "source-only"] as const)(
    "replays the complete %s primary statement and keeps business-sale gains separate",
    async (mode) => {
      const { period: p, company } = await (mode === "preserved"
        ? standaloneBusinessFixture("ALB")
        : sourceOnlyBusinessFixture("ALB"));
      expect(grossOperatingItemsProblem(p)).toBeUndefined();
      expect(p.grossOperatingItems?.operatingCosts.map((l) => l.amount)).toEqual([
        353765000, 80475000, -122298000, 57384000
      ]);
      expect(p.metrics.operatingExpenses).toBe(369326000);
      expect(p.metrics.equityMethodIncome).toBe(59637000);
      expect(p.metrics.afterTaxSubsidiaryIncome).toBeUndefined();
      expect(p.metrics.discontinuedOperationsIncome).toBe(202131000);
      expect(p.metrics.noncontrollingInterestIncome).toBe(37094000);
      expect(p.metrics.netIncome).toBe(643675000);
      const statement = flowPeriod(JSON.parse(JSON.stringify(p)));
      expect(statement).toBeDefined();
      const result = buildStatementFlow(statement!);
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.reason);
      const node = (id: string) => result.graph.nodes.find((n) => n.id === id)!;
      expect(node("opex").amount).toBe(491624000);
      expect(node("opex").label).toBe("Operating expenses (before business-sale gains)");
      expect(node("operating-reversal-alb-original-income-9").amount).toBe(122298000);
      expect(node("equity").amount).toBe(59637000);
      expect(node("discontinued").amount).toBe(202131000);
      expect(node("noncontrolling").amount).toBe(37094000);
      for (const n of result.graph.nodes) {
        const incoming = result.graph.links
          .filter((l) => l.target === n.id)
          .reduce((sum, l) => sum + l.value, 0);
        const outgoing = result.graph.links
          .filter((l) => l.source === n.id)
          .reduce((sum, l) => sum + l.value, 0);
        if (incoming && outgoing) expect(incoming).toBe(outgoing);
      }
      expect(p.metrics.revenue! + 122298000).toBe(
        p.metrics.costOfRevenue! + 491624000 + p.metrics.operatingIncome!
      );
      expect(
        p.metrics.pretaxIncome! -
          p.metrics.incomeTax! +
          p.metrics.equityMethodIncome! +
          p.metrics.discontinuedOperationsIncome! -
          p.metrics.noncontrollingInterestIncome!
      ).toBe(p.metrics.netIncome);
      validateV2(company);
    }
  );
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "gain amount",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].amount += 1000;
      }
    ],
    [
      "gain sign",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].amount *= -1;
      }
    ],
    [
      "gain label",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].label = "Source rounding";
      }
    ],
    [
      "gain concept",
      (p) => {
        p.grossOperatingItems!.operatingCosts[2].tag = "us-gaap:OtherOperatingIncome";
      }
    ],
    [
      "omitted acquisition costs",
      (p) => {
        p.grossOperatingItems!.operatingCosts.pop();
      }
    ],
    [
      "equity amount",
      (p) => {
        p.metrics.equityMethodIncome! += 1000;
      }
    ],
    [
      "discontinued amount",
      (p) => {
        p.metrics.discontinuedOperationsIncome = 0;
      }
    ],
    [
      "subsidiary scope substituted",
      (p) => {
        p.metrics.afterTaxSubsidiaryIncome = p.metrics.equityMethodIncome;
        delete p.metrics.equityMethodIncome;
        delete p.metricSources.equityMethodIncome;
      }
    ],
    [
      "calculation mislabeled reported",
      (p) => {
        p.metricSources.operatingExpenses!.method = "reported";
      }
    ],
    [
      "calculated precision invented",
      (p) => {
        p.metricSources.operatingExpenses!.decimals = -3;
      }
    ],
    [
      "net expenses changed",
      (p) => {
        p.metrics.operatingExpenses! += 1000;
      }
    ],
    [
      "wrong period",
      (p) => {
        p.grossOperatingItems!.startDate = "2015-01-01";
      }
    ],
    [
      "wrong source",
      (p) => {
        p.grossOperatingItems!.sourceUrl = p.sourceUrl.replace("915913/", "1037868/");
      }
    ],
    [
      "missing original proof",
      (p) => {
        delete p.grossOperatingItems!.standaloneSource;
      }
    ],
    [
      "invented rounding",
      (p) => {
        p.operatingReconciliation = {
          amount: 1000,
          label: "Source rounding",
          sourceUrl: p.sourceUrl,
          basis: "gross-profit"
        };
      }
    ],
    [
      "altered original XML",
      (p) => {
        const s = p.grossOperatingItems!.standaloneSource!.source;
        s.originalXml.declarations = s.originalXml.declarations.map((x) =>
          x.replace(">122298000<", ">122299000<")
        );
      }
    ],
    [
      "changed original currency",
      (p) => {
        const s = p.grossOperatingItems!.standaloneSource!.source;
        s.originalXml.units = s.originalXml.units.map((x) =>
          x.replace("iso4217:USD", "iso4217:CAD")
        );
      }
    ]
  ];
  it.each(mutations)("withholds %s", async (_name, mutate) => {
    const { period } = await standaloneBusinessFixture("ALB");
    const p = structuredClone(period);
    mutate(p);
    expect(grossOperatingItemsProblem(p)).toBeTruthy();
    expect(flowPeriod(p)).toBeUndefined();
  });
});
