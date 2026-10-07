import type { PeriodV2 } from "./v2-types";
import type { RevenueSegment } from "./types";
import type { OriginalStandaloneBusinessProof } from "./standalone-business";
import { replayOriginalStandaloneSourceProof } from "./standalone-source-proof";
import {
  replayOriginalStandaloneRevenueTable,
  type OriginalStandaloneTableSelection
} from "./standalone-revenue-rows";

export const agilentStandaloneRule = "agilent-original-separate-fiscal-segments-v1";
export const agilentStandaloneBasis =
  "Reported original Agilent Life Sciences and Applied Markets, Diagnostics and Genomics, and Agilent CrossLab revenue. The complete segment table independently reconciles to primary consolidated net revenue, preserving original XML declarations, million-dollar units and November–October fiscal periods. Segment operating income is not gross profit; no residual or business gross profit is estimated.";
const demand = (condition: unknown, message = "Changed original Agilent fiscal statement") => {
  if (!condition) throw Error(message);
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const revenueTag = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const product = { "srt:ProductOrServiceAxis": "us-gaap:ProductMember" };
const service = { "srt:ProductOrServiceAxis": "us-gaap:ServiceOtherMember" };
// Original concepts, dimensions, visible labels and geometry; never monetary values.
const primaryBindings = [
  [6, "Products", revenueTag, product, "same"],
  [7, "Services and other", revenueTag, service, "same"],
  [8, "Total net revenue", revenueTag, {}, "same"],
  [10, "Cost of products", "us-gaap:CostOfGoodsAndServicesSold", product, "same"],
  [11, "Cost of services and other", "us-gaap:CostOfGoodsAndServicesSold", service, "same"],
  [12, "Total costs", "us-gaap:CostOfGoodsAndServicesSold", {}, "same"],
  [13, "Research and development", "us-gaap:ResearchAndDevelopmentExpense", {}, "same"],
  [
    14,
    "Selling, general and administrative",
    "us-gaap:SellingGeneralAndAdministrativeExpense",
    {},
    "same"
  ],
  [15, "Total costs and expenses", "us-gaap:CostsAndExpenses", {}, "same"],
  [16, "Income from operations", "us-gaap:OperatingIncomeLoss", {}, "same"],
  [17, "Interest income", "us-gaap:InvestmentIncomeInterest", {}, "same"],
  [18, "Interest expense", "us-gaap:InterestExpense", {}, "opposite"],
  [19, "Other income (expense), net", "us-gaap:OtherNonoperatingIncomeExpense", {}, "same"],
  [
    20,
    "Income before taxes",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    {},
    "same"
  ],
  [21, "Provision for income taxes", "us-gaap:IncomeTaxExpenseBenefit", {}, "same"],
  [22, "Net income", "us-gaap:ProfitLoss", {}, "same"]
] as const;
const segmentLabels = [
  "Life Sciences and Applied Markets",
  "Diagnostics and Genomics",
  "Agilent CrossLab",
  "Total Segments"
];
const segmentMembers = [
  "a:LifeSciencesandAppliedMarketsMember",
  "a:DiagnosticsAndGenomicsMember",
  "a:AgilentCrossLabMember",
  "a:SegmentTotalMember"
];
const segmentRows = [
  ["Total net revenue", revenueTag],
  ["Income from operations", "us-gaap:OperatingIncomeLoss"],
  ["Depreciation expense", "us-gaap:Depreciation"],
  ["Share-based compensation expense", "us-gaap:ShareBasedCompensation"]
] as const;
export function agilentStandaloneSelections(
  year: number,
  primaryIndex: number,
  businessIndex: number
): OriginalStandaloneTableSelection[] {
  demand([2016, 2017, 2018].includes(year) && primaryIndex !== businessIndex);
  const common = {
    calendarYear: year,
    fiscalProfile: "agilent-october" as const,
    scale: 6 as const,
    period: { startDate: `${year - 1}-11-01`, endDate: `${year}-10-31` }
  };
  const heading = 4 + (2018 - year) * 5;
  const businessColumns = [
    { columnIndex: 1, span: 4 },
    { columnIndex: 5, span: 4 },
    { columnIndex: 9, span: 4 },
    { columnIndex: 13, span: 3 }
  ];
  return [
    {
      ...common,
      tableIndex: primaryIndex,
      units: { rowIndex: 4, label: "(in millions, except per share data)" },
      headers: { rowIndex: 3, labels: ["2018", "2017", "2016"], selectedIndex: 2018 - year },
      rows: primaryBindings.map(([rowIndex, label, tag, dimensions, displayPolarity]) => ({
        rowIndex,
        label,
        tag,
        dimensions,
        displayPolarity,
        columns: [
          { columnIndex: 1, span: 4 },
          { columnIndex: 5, span: 4 },
          { columnIndex: 9, span: 3 }
        ]
      }))
    },
    {
      ...common,
      tableIndex: businessIndex,
      units: { rowIndex: 3, label: "(in millions)" },
      headers: { rowIndex: 2, labels: segmentLabels, selectedIndex: 0 },
      yearHeader: { rowIndex: heading, label: `Year ended October 31, ${year}:` },
      rows: segmentRows.flatMap(([label, tag], row) =>
        segmentMembers.map((member, selectedColumn) => ({
          rowIndex: heading + 1 + row,
          label,
          tag,
          selectedColumn,
          dimensions: { "us-gaap:StatementBusinessSegmentsAxis": member },
          columns: businessColumns
        }))
      )
    }
  ];
}
type Join = ReturnType<typeof replayOriginalStandaloneRevenueTable>;
function checkIncome(join: Join) {
  const v = (row: number) => join.monetaryRows.find((r) => r.rowIndex === row)!.originalFact.value;
  demand([6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18].every((r) => v(r) >= 0));
  demand(v(6) + v(7) === v(8));
  demand(v(10) + v(11) === v(12));
  demand(v(12) + v(13) + v(14) === v(15));
  demand(v(8) - v(15) === v(16));
  demand(v(16) + v(17) - v(18) + v(19) === v(20));
  demand(v(20) - v(21) === v(22));
}
function checkSegments(primary: Join, business: Join) {
  for (let i = 0; i < 4; i++) {
    const rows = business.monetaryRows.slice(i * 4, (i + 1) * 4);
    demand(
      rows.length === 4 &&
        rows.slice(0, 3).reduce((n, r) => n + r.originalFact.value, 0) ===
          rows[3].originalFact.value
    );
    demand(rows.every((r) => r.originalFact.value >= 0));
  }
  demand(
    business.monetaryRows[3].originalFact.value ===
      primary.monetaryRows.find((r) => r.rowIndex === 8)!.originalFact.value
  );
}
export function agilentStandaloneMetrics(
  p: Pick<PeriodV2, "sourceUrl" | "accession" | "filedAt">,
  primary: Join
): Pick<PeriodV2, "metrics" | "metricSources"> {
  checkIncome(primary);
  const metrics: PeriodV2["metrics"] = {},
    metricSources: PeriodV2["metricSources"] = {};
  const keys = [
    ["revenue", 8],
    ["costOfRevenue", 12],
    ["researchAndDevelopment", 13],
    ["sellingGeneralAndAdministrative", 14],
    ["totalOperatingCosts", 15],
    ["operatingIncome", 16],
    ["pretaxIncome", 20],
    ["incomeTax", 21],
    ["netIncome", 22]
  ] as const;
  for (const [key, index] of keys) {
    const r = primary.monetaryRows.find((r) => r.rowIndex === index)!;
    metrics[key] = r.originalFact.value;
    metricSources[key] = {
      label: r.label,
      tag: r.originalFact.tag,
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      method: "reported",
      decimals: r.originalFact.decimals
    };
  }
  return { metrics, metricSources };
}
export function agilentStandaloneCostDetails(
  primary: Join
): NonNullable<PeriodV2["operatingCostDetails"]> {
  checkIncome(primary);
  return primary.monetaryRows
    .filter((r) => [10, 11, 13, 14].includes(r.rowIndex))
    .map((r) => ({
      id: `original-line-${r.rowIndex}`,
      label: r.label,
      amount: r.originalFact.value,
      tag: r.originalFact.tag,
      decimals: r.originalFact.decimals
    }));
}
export function agilentStandaloneSegments(
  p: PeriodV2,
  proof: OriginalStandaloneBusinessProof
): RevenueSegment[] {
  const s = proof.source;
  demand(
    proof.ruleId === agilentStandaloneRule &&
      s.cik === "0001090872" &&
      proof.form === "10-K" &&
      proof.reportDate === "2018-10-31" &&
      s.accession === "0001090872-18-000019" &&
      p.kind === "annual" &&
      [2016, 2017, 2018].includes(p.fiscalYear) &&
      p.startDate === `${p.fiscalYear - 1}-11-01` &&
      p.endDate === `${p.fiscalYear}-10-31` &&
      p.sourceUrl === s.primarySource.url &&
      p.accession === s.accession &&
      proof.reportDate <= p.filedAt &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.revenueAdjustments?.length &&
      s.tables.length === 2
  );
  const { instance, joins } = replayOriginalStandaloneSourceProof(s),
    [primary, business] = s.tables;
  for (const [prefix, uri] of Object.entries({
    "us-gaap": "http://fasb.org/us-gaap/2018-01-31",
    srt: "http://fasb.org/srt/2018-01-31",
    dei: "http://xbrl.sec.gov/dei/2018-01-31",
    a: "http://www.agilent.com/20181031"
  }))
    demand(instance.namespaces[prefix] === uri);
  for (const [tag, value] of [
    ["dei:DocumentFiscalYearFocus", "2018"],
    ["dei:DocumentFiscalPeriodFocus", "FY"],
    ["dei:DocumentPeriodEndDate", "2018-10-31"]
  ]) {
    const matches = instance.metadata.filter((m) => m.tag === tag);
    demand(matches.length === 1 && matches[0].lexical === value);
  }
  demand(
    instance.contexts.every((c) => Number(c.cik) === 1090872 && !c.typed && !c.unreviewedScope)
  );
  const expected = agilentStandaloneSelections(
    p.fiscalYear,
    primary.tableIndex,
    business.tableIndex
  );
  demand(s.tables.every((t, i) => canonical(t.selection) === canonical(expected[i])));
  demand(
    primary.rows.length === 33 &&
      primary.precedingText.endsWith(
        "AGILENT TECHNOLOGIES, INC. CONSOLIDATED STATEMENT OF OPERATIONS"
      )
  );
  const labels = (t: typeof primary, index: number) =>
    t.rows[index].cells.filter((c) => c.label).map((c) => c.label);
  demand(canonical(labels(primary, 2)) === canonical(["Years Ended October 31,"]));
  demand(canonical(labels(primary, 5)) === canonical(["Net revenue:"]));
  demand(canonical(labels(primary, 9)) === canonical(["Costs and expenses:"]));
  for (const row of primary.rows.slice(0, 2)) demand(row.cells.every((c) => !c.label));
  demand(
    business.rows.length === 19 &&
      business.precedingText.endsWith(
        "The profitability of each of the segments is measured after excluding restructuring and asset impairment charges, transformational initiatives, investment gains and losses, interest income, interest expense, acquisition and integration costs, non-cash amortization and other items as noted in the reconciliations below."
      )
  );
  for (const row of business.rows.slice(0, 2)) demand(row.cells.every((c) => !c.label));
  for (const year of [2018, 2017, 2016]) {
    const selections = agilentStandaloneSelections(year, primary.tableIndex, business.tableIndex);
    const a = replayOriginalStandaloneRevenueTable(
      { cik: s.cik, instance },
      primary,
      selections[0]
    );
    const b = replayOriginalStandaloneRevenueTable(
      { cik: s.cik, instance },
      business,
      selections[1]
    );
    checkIncome(a);
    checkSegments(a, b);
  }
  const totals = agilentStandaloneMetrics(p, joins[0]);
  demand(proof.primaryProfile === undefined || proof.primaryProfile === "income-statement");
  if (p.operatingCostDetails)
    demand(canonical(p.operatingCostDetails) === canonical(agilentStandaloneCostDetails(joins[0])));
  if (proof.primaryProfile)
    demand(
      canonical(p.metricSources) === canonical(totals.metricSources) &&
        canonical(p.operatingCostDetails) === canonical(agilentStandaloneCostDetails(joins[0]))
    );
  for (const [key, value] of Object.entries(totals.metrics)) {
    const k = key as keyof PeriodV2["metrics"];
    if (proof.primaryProfile || p.metrics[k] !== undefined)
      demand(p.metrics[k] === value, `Original ${key} differs from preserved amount`);
  }
  demand(
    p.metrics.revenue === totals.metrics.revenue &&
      p.metricSources.revenue?.tag === revenueTag &&
      p.metricSources.revenue.method === "reported"
  );
  return joins[1].monetaryRows.slice(0, 3).map((r, i) => ({
    id: `reported-${segmentMembers[i]!.split(":")[1]}`,
    label: segmentLabels[i],
    revenue: r.originalFact.value,
    revenueSource: {
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      startDate: p.startDate,
      endDate: p.endDate,
      currency: "USD",
      tag: r.originalFact.tag,
      dimensions: r.originalFact.context.dimensions,
      value: r.originalFact.value,
      decimals: r.originalFact.decimals,
      tableLabel: r.label,
      columnLabel: segmentLabels[i]
    }
  }));
}
export function agilentStandaloneProblem(p: PeriodV2) {
  try {
    const e = p.businessBreakdownSource,
      proof = e?.standaloneRevenue;
    demand(
      e?.method === "reviewed-original-standalone-revenue" &&
        proof &&
        e.ruleId === agilentStandaloneRule &&
        e.ruleId === proof!.ruleId &&
        e.tableIndex === proof!.source.tables[1].tableIndex &&
        e.totalTableIndex === proof!.source.tables[0].tableIndex &&
        e.sourceUrl === p.sourceUrl &&
        e.accession === p.accession &&
        e.revenue === p.metrics.revenue &&
        e.revenueTag === p.metricSources.revenue?.tag &&
        e.revenueDecimals === -6 &&
        e.totalLabel === "Total net revenue" &&
        !e.axis &&
        !e.qualifiers &&
        !e.ametekRevenue &&
        !e.albemarleRevenue &&
        !e.productPortfolios &&
        !e.serviceRevenueRows &&
        !e.externalCustomerColumns &&
        !e.originalRevenueRows &&
        !e.omittedSubtotals.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === agilentStandaloneBasis
    );
    demand(canonical(p.segments) === canonical(agilentStandaloneSegments(p, proof!)));
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Agilent proof";
  }
}
