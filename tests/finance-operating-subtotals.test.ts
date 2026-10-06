import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import catalog from "../src/data/generated/finance-catalog.json";
import sources from "./fixtures/finance/operating-subtotal-sources.json";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichOperatingPeriods } from "../scripts/finance/operating-v2";
import { enrichBusinessPeriods } from "../scripts/finance/business-v2";
import { enrichReviewedBusinessPeriods } from "../scripts/finance/reviewed-business";
import { enrichMatrixBusinessPeriods } from "../scripts/finance/business-matrix";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { flowPeriod, businessPeriod } from "../scripts/finance/v2-model";
import { operatingItemRules, operatingItemsProblem } from "../src/features/finance/operating-items";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2, CatalogCompany } from "../src/features/finance/v2-types";
import type { SecFiling } from "../scripts/finance/sec-shared";
const million = 1e6,
  thousand = 1e3;
const golden = {
  "SPGI-FY2025": [
    15336 * million,
    9159 * million,
    6478 * million,
    6227 * million,
    1407 * million,
    4471 * million,
    349 * million
  ],
  "SPGI-2026-Q2": [
    4146 * million,
    2345 * million,
    1812 * million,
    1729 * million,
    406 * million,
    1217 * million,
    106 * million
  ],
  "CARR-FY2025": [
    21747 * million,
    19840 * million,
    2172 * million,
    1798 * million,
    240 * million,
    1484 * million,
    103 * million
  ],
  "CARR-2026-Q2": [
    6351 * million,
    5581 * million,
    825 * million,
    721 * million,
    180 * million,
    501 * million,
    40 * million
  ],
  "PLD-FY2025": [
    8790127 * thousand,
    5375825 * thousand,
    4357864 * thousand,
    3769316 * thousand,
    204017 * thousand,
    3328231 * thousand,
    237068 * thousand
  ],
  "PLD-2026-Q2": [
    2425452 * thousand,
    1465761 * thousand,
    1251336 * thousand,
    1232127 * thousand,
    108173 * thousand,
    1062191 * thousand,
    61763 * thousand
  ]
} as const;
function fixture(source: (typeof sources)[number]) {
  const identity = catalog.companies.find((c) => c.ticker === source.ticker)! as CatalogCompany;
  const rule = operatingItemRules.find((r) => r.cik === identity.cik)!;
  const key = `${source.ticker}-${source.id}` as keyof typeof golden;
  const amounts = golden[key];
  const kind = source.id.startsWith("FY") ? "annual" : "quarterly";
  const filing: SecFiling = {
    accession: source.accession,
    filedAt: source.filedAt,
    reportDate: source.endDate,
    form: kind === "annual" ? "10-K" : "10-Q",
    sourceUrl: source.sourceUrl,
    primaryDocument: source.sourceUrl.split("/").at(-1)!,
    directoryUrl: source.sourceUrl.slice(0, source.sourceUrl.lastIndexOf("/") + 1)
  };
  const period: PeriodV2 = {
    id: source.id,
    label: source.id,
    kind,
    fiscalYear: Number(source.id.replace("FY", "").slice(0, 4)),
    ...(kind === "quarterly" ? { fiscalQuarter: Number(source.id.at(-1)) as 1 | 2 | 3 | 4 } : {}),
    startDate: source.startDate,
    endDate: source.endDate,
    filedAt: source.filedAt,
    accession: source.accession,
    sourceUrl: source.sourceUrl,
    reportingCurrency: "USD",
    displayCurrency: "USD",
    derived: false,
    metrics: { revenue: amounts[0] },
    metricSources: {
      revenue: {
        label: "Reported revenue",
        tag: rule.revenueTag,
        sourceUrl: source.sourceUrl,
        filedAt: source.filedAt,
        accession: source.accession,
        method: "reported"
      }
    },
    coverage: { basics: true, sankey: false, segments: false }
  };
  const html = readFileSync(
    new URL(`./fixtures/finance/${key}-statement.html`, import.meta.url),
    "utf8"
  );
  return { identity, filing, period, html, amounts };
}
describe("original reported operating subtotals", () => {
  for (const source of sources)
    it(`${source.ticker} ${source.id} retains reported subtotals, exclusive cost scopes and signed gains`, () => {
      const { identity, filing, period, html, amounts } = fixture(source);
      const result = enrichOperatingPeriods(html, identity, filing, [period]);
      expect(result).toHaveLength(1);
      const actual = result[0]!;
      expect([
        actual.metrics.revenue,
        actual.metrics.totalOperatingCosts,
        actual.metrics.operatingIncome,
        actual.metrics.pretaxIncome,
        actual.metrics.incomeTax,
        actual.metrics.netIncome,
        actual.metrics.noncontrollingInterestIncome
      ]).toEqual(amounts);
      expect(actual.metrics.grossProfit).toBeUndefined();
      expect(actual.metricSources.totalOperatingCosts?.method).toBe("reported");
      expect(actual.operatingItems?.costSubtotal?.amount).toBe(amounts[1]);
      expect(
        actual.operatingItems?.items.some((l) => l.tag === actual.operatingItems?.costSubtotal?.tag)
      ).toBe(false);
      expect(operatingItemsProblem(actual)).toBeUndefined();
      expect(flowPeriod(actual)).toBeDefined();
      if (source.ticker === "CARR")
        expect(
          actual.operatingItems?.items
            .filter((l) => l.tag === "us-gaap:CostOfGoodsAndServicesSold")
            .map((l) => l.dimensions)
        ).toEqual([
          { "srt:ProductOrServiceAxis": "us-gaap:ProductMember" },
          { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" }
        ]);
      if (source.ticker === "PLD")
        expect(actual.operatingItems?.operatingSubtotal?.amount).toBe(
          source.id === "FY2025" ? 3414302 * thousand : 959691 * thousand
        );
      const parsed = parseInlineXbrl(html);
      const enriched = [
        ...enrichBusinessPeriods(html, identity, filing, [actual], parsed),
        ...enrichReviewedBusinessPeriods(html, identity, filing, [actual], parsed),
        ...enrichMatrixBusinessPeriods(html, identity, filing, [actual], parsed)
      ];
      expect(enriched).toHaveLength(1);
      expect(businessPeriod(enriched[0]!)).toBeDefined();
      const graph = buildStatementFlow(flowPeriod(enriched[0]!)!);
      expect(graph.ok).toBe(true);
      if (graph.ok)
        for (const segment of enriched[0]!.segments ?? [])
          expect(graph.graph.nodes.find((n) => n.id === `segment-${segment.id}`)?.amount).toBe(
            segment.revenue
          );
    });
  it.each([
    "SPGISubtotalsAnnual",
    "SPGISubtotalsQuarter",
    "CARRSubtotalsAnnual",
    "CARRSubtotalsQuarter",
    "PLDSubtotalsAnnual",
    "PLDSubtotalsQuarter"
  ] as const)("%s supports the shared source-derived import fixture", (key) => {
    const { period } = reviewedFixture(key);
    expect(flowPeriod(period)).toBeDefined();
    expect(businessPeriod(period)).toBeDefined();
    expect(period.operatingItems?.costSubtotal).toBeDefined();
    if (key === "PLDSubtotalsAnnual")
      expect(period.operatingItems?.excludedSegmentExpenses?.totalExpenses.amount).toBe(
        -2280683000
      );
  });
  it("keeps Prologis segment-NOI costs outside the original consolidated ledger", () => {
    const source = sources.find((s) => s.ticker === "PLD" && s.id === "FY2025")!;
    const { identity, filing, period, html, amounts } = fixture(source);
    period.metrics.operatingExpenses = -2280683000;
    period.metricSources.operatingExpenses = {
      label: "Operating Expenses",
      tag: "us-gaap:OperatingExpenses",
      sourceUrl: filing.sourceUrl,
      accession: filing.accession,
      filedAt: filing.filedAt,
      method: "reported"
    };
    const original = structuredClone(period);
    const actual = enrichOperatingPeriods(html, identity, filing, [period])[0]!;
    expect(period).toEqual(original);
    expect(actual).toBeDefined();
    expect(actual.metrics.operatingExpenses).toBeUndefined();
    expect(actual.metricSources.operatingExpenses).toBeUndefined();
    expect(actual.operatingItems!.excludedSegmentExpenses).toMatchObject({
      tableIndex: 1,
      revenue: { amount: 8790127000, tag: "us-gaap:Revenues" },
      totalExpenses: { amount: -2280683000, tag: "us-gaap:OperatingExpenses" },
      segmentIncome: { amount: 6509444000, tag: "us-gaap:OperatingIncomeLoss" },
      originalMetricSource: original.metricSources.operatingExpenses
    });
    expect(actual.metrics.totalOperatingCosts).toBe(amounts[1]);
    expect(actual.metrics.operatingIncome).toBe(amounts[2]);
    expect(flowPeriod(actual)).toBeDefined();
    const pipeline = readGenericFiling(html, identity, filing, undefined, [period]).find(
      (p) => p.id === period.id
    )!;
    expect(flowPeriod(pipeline)).toBeDefined();
    expect(businessPeriod(pipeline)).toBeDefined();
    const graph = buildStatementFlow(flowPeriod(pipeline)!);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      expect(graph.graph.nodes.find((n) => n.id === "operating-costs")?.amount).toBe(5375825000);
      expect(
        graph.graph.nodes.some((n) => n.amount === 2280683000 || n.amount === -2280683000)
      ).toBe(false);
    }
    for (const change of [
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.totalExpenses.amount += 1000;
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.tableIndex = p.operatingItems!.tableIndex;
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.segmentIncome.tag = "us-gaap:NetIncomeLoss";
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.segmentIncome.label = "Operating income";
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.revenue.dimensions = {
          "us-gaap:StatementBusinessSegmentsAxis": "pld:RealEstateSegmentMember"
        };
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.originalMetricSource.accession =
          "0001193125-26-999999";
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.originalMetricSource.method = "calculated";
      },
      (p: PeriodV2) => {
        p.metrics.operatingExpenses = -2280683000;
      },
      (p: PeriodV2) => {
        p.operatingItems!.excludedSegmentExpenses!.segmentIncome.rowIndex =
          p.operatingItems!.excludedSegmentExpenses!.totalExpenses.rowIndex;
      }
    ]) {
      const changed = structuredClone(actual);
      change(changed);
      expect(operatingItemsProblem(changed)).toBeDefined();
      expect(flowPeriod(changed)).toBeUndefined();
    }
    expect(
      enrichOperatingPeriods(
        html.replaceAll("Total segment net operating income", "Operating income"),
        identity,
        filing,
        [period]
      )
    ).toEqual([]);
    const missingScope = structuredClone(period);
    missingScope.metrics.operatingExpenses = -1;
    expect(enrichOperatingPeriods(html, identity, filing, [missingScope])).toEqual([]);
  });
  it("withholds changed or duplicated subtotal proofs, mis-scoped costs and source-order gaps", () => {
    const source = sources.find((s) => s.ticker === "CARR" && s.id === "2026-Q2")!;
    const { identity, filing, period, html } = fixture(source);
    const actual = enrichOperatingPeriods(html, identity, filing, [period])[0]!;
    expect(actual).toBeDefined();
    for (const change of [
      (p: PeriodV2) => {
        p.operatingItems!.costSubtotal!.amount += 1e6;
      },
      (p: PeriodV2) => {
        p.operatingItems!.costSubtotal!.rowIndex++;
      },
      (p: PeriodV2) => {
        delete p.operatingItems!.costSubtotal;
      },
      (p: PeriodV2) => {
        p.operatingItems!.items[0]!.dimensions = {};
      },
      (p: PeriodV2) => {
        p.operatingItems!.items.push({ ...p.operatingItems!.costSubtotal!, effect: "cost" });
      },
      (p: PeriodV2) => {
        p.operatingItems!.items[0]!.rowIndex++;
      },
      (p: PeriodV2) => {
        p.metricSources.totalOperatingCosts!.tag = "us-gaap:InterestExpense";
      },
      (p: PeriodV2) => {
        p.metricSources.totalOperatingCosts!.method = "calculated";
      },
      (p: PeriodV2) => {
        p.operatingItems!.operatingSubtotal = { ...p.operatingItems!.costSubtotal! };
      },
      (p: PeriodV2) => {
        p.operatingItems!.items.at(-1)!.amount *= -1;
      }
    ]) {
      const changed = structuredClone(actual);
      change(changed);
      expect(operatingItemsProblem(changed)).toBeDefined();
      expect(flowPeriod(changed)).toBeUndefined();
    }
  });
});
