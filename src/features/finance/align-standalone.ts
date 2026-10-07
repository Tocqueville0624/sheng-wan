import type { PeriodV2 } from "./v2-types";
import type { RevenueSegment } from "./types";
import type { OriginalStandaloneBusinessProof } from "./standalone-business";
import { replayOriginalStandaloneSourceProof } from "./standalone-source-proof";
import {
  replayOriginalStandaloneRevenueTable,
  type OriginalStandaloneTableSelection
} from "./standalone-revenue-rows";

export const alignStandaloneRule = "align-original-separate-segment-revenue-v1";
export const alignStandaloneBasis =
  "Reported original Align Technology Clear Aligner and Scanner revenue. The complete original business revenue section reconciles to independently reported consolidated net revenue in every comparative year. Original HTML labels, XML declarations, thousand-dollar units and signed after-tax equity losses are preserved. No business amount or gross profit is estimated.";
export const alignPrimaryHeading =
  "ALIGN TECHNOLOGY, INC. AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF OPERATIONS (in thousands, except per share data)";
export const alignBusinessHeading =
  "The following information relates to these segments (in thousands):";
const demand = (condition: unknown, message = "Changed original Align Technology statement") => {
  if (!condition) throw Error(message);
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const revenueTag = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const primaryBindings = [
  [4, "Net revenues", revenueTag, "same"],
  [5, "Cost of net revenues", "us-gaap:CostOfRevenue", "same"],
  [6, "Gross profit", "us-gaap:GrossProfit", "same"],
  [8, "Selling, general and administrative", "us-gaap:SellingAndMarketingExpense", "same"],
  [9, "Research and development", "us-gaap:ResearchAndDevelopmentExpense", "same"],
  [10, "Total operating expenses", "us-gaap:OperatingExpenses", "same"],
  [11, "Income from operations", "us-gaap:OperatingIncomeLoss", "same"],
  [12, "Interest income", "us-gaap:InterestIncomeOperating", "same"],
  [13, "Other income (expense), net", "us-gaap:OtherNonoperatingIncomeExpense", "same"],
  [
    14,
    "Net income before provision for income taxes and equity in losses of investee",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "same"
  ],
  [15, "Provision for income taxes", "us-gaap:IncomeTaxExpenseBenefit", "same"],
  [
    16,
    "Equity in losses of investee, net of tax",
    "us-gaap:IncomeLossFromEquityMethodInvestments",
    "opposite"
  ],
  [17, "Net income", "us-gaap:NetIncomeLoss", "same"]
] as const;
// These legacy XML names do not describe the visible business names. Bind them
// only to this reviewed source's physical rows; never derive labels from QNames.
const businessBindings = [
  [5, "Clear Aligner", "algn:InvisalignFullMember"],
  [6, "Scanner", "algn:InvisalignExpressliteMember"]
] as const;
export function alignStandaloneSelections(
  year: number,
  primaryIndex: number,
  businessIndex: number
): OriginalStandaloneTableSelection[] {
  demand([2016, 2017, 2018].includes(year) && primaryIndex !== businessIndex);
  const common = {
    calendarYear: year,
    period: { startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    headers: { rowIndex: 3, labels: ["2018", "2017", "2016"], selectedIndex: 2018 - year }
  };
  const columns = [
    { columnIndex: 1, span: 4 },
    { columnIndex: 5, span: 4 },
    { columnIndex: 9, span: 3 }
  ];
  return [
    {
      ...common,
      tableIndex: primaryIndex,
      units: { precedingTextSuffix: alignPrimaryHeading },
      rows: primaryBindings.map(([rowIndex, label, tag, displayPolarity]) => ({
        rowIndex,
        label,
        tag,
        displayPolarity,
        dimensions: {},
        columns
      }))
    },
    {
      ...common,
      tableIndex: businessIndex,
      units: { precedingTextSuffix: alignBusinessHeading },
      rows: [
        ...businessBindings.map(([rowIndex, label, member]) => ({
          rowIndex,
          label,
          tag: revenueTag,
          dimensions: { "us-gaap:StatementBusinessSegmentsAxis": member },
          columns
        })),
        { rowIndex: 7, label: "Total net revenues", tag: revenueTag, dimensions: {}, columns }
      ]
    }
  ];
}
type Join = ReturnType<typeof replayOriginalStandaloneRevenueTable>;
function checkIncome(join: Join) {
  const v = (row: number) => join.monetaryRows.find((r) => r.rowIndex === row)!.originalFact.value;
  demand([4, 5, 6, 8, 9, 10, 12].every((r) => v(r) >= 0));
  demand(v(16) <= 0);
  demand(v(4) - v(5) === v(6));
  demand(v(8) + v(9) === v(10));
  demand(v(6) - v(10) === v(11));
  demand(v(11) + v(12) + v(13) === v(14));
  demand(v(14) - v(15) + v(16) === v(17));
}
function checkSegments(primary: Join, business: Join) {
  const rows = business.monetaryRows;
  demand(rows.length === 3 && rows.every((r) => r.originalFact.value >= 0));
  demand(rows[0].originalFact.value + rows[1].originalFact.value === rows[2].originalFact.value);
  demand(rows[2].originalFact.value === primary.monetaryRows[0].originalFact.value);
}
export function alignStandaloneMetrics(
  p: Pick<PeriodV2, "sourceUrl" | "accession" | "filedAt">,
  primary: Join
): Pick<PeriodV2, "metrics" | "metricSources"> {
  checkIncome(primary);
  const metrics: PeriodV2["metrics"] = {},
    metricSources: PeriodV2["metricSources"] = {};
  const keys = [
    ["revenue", 4],
    ["costOfRevenue", 5],
    ["grossProfit", 6],
    ["sellingGeneralAndAdministrative", 8],
    ["researchAndDevelopment", 9],
    ["operatingExpenses", 10],
    ["operatingIncome", 11],
    ["pretaxIncome", 14],
    ["incomeTax", 15],
    ["equityMethodIncome", 16],
    ["netIncome", 17]
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
export function alignStandaloneSegments(
  p: PeriodV2,
  proof: OriginalStandaloneBusinessProof
): RevenueSegment[] {
  const s = proof.source;
  demand(
    proof.ruleId === alignStandaloneRule &&
      s.cik === "0001097149" &&
      proof.form === "10-K" &&
      proof.reportDate === "2018-12-31" &&
      s.accession === "0001097149-19-000009" &&
      p.filedAt === "2019-02-28" &&
      p.kind === "annual" &&
      [2016, 2017, 2018].includes(p.fiscalYear) &&
      p.startDate === `${p.fiscalYear}-01-01` &&
      p.endDate === `${p.fiscalYear}-12-31` &&
      p.sourceUrl === s.primarySource.url &&
      p.accession === s.accession &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.revenueAdjustments?.length &&
      s.tables.length === 2
  );
  const { instance, joins } = replayOriginalStandaloneSourceProof(s),
    [primary, business] = s.tables;
  for (const [prefix, uri] of Object.entries({
    "us-gaap": "http://fasb.org/us-gaap/2018-01-31",
    dei: "http://xbrl.sec.gov/dei/2018-01-31",
    algn: "http://www.aligntech.com/20181231"
  }))
    demand(instance.namespaces[prefix] === uri);
  for (const [tag, value] of [
    ["dei:DocumentFiscalYearFocus", "2018"],
    ["dei:DocumentFiscalPeriodFocus", "FY"],
    ["dei:DocumentPeriodEndDate", "2018-12-31"]
  ]) {
    const matches = instance.metadata.filter((m) => m.tag === tag);
    demand(matches.length === 1 && matches[0].lexical === value);
  }
  demand(
    instance.contexts.every((c) => Number(c.cik) === 1097149 && !c.typed && !c.unreviewedScope)
  );
  const expected = alignStandaloneSelections(p.fiscalYear, primary.tableIndex, business.tableIndex);
  demand(s.tables.every((t, i) => canonical(t.selection) === canonical(expected[i])));
  demand(primary.rows.length === 25 && primary.precedingText.endsWith(alignPrimaryHeading));
  demand(business.rows.length === 22 && business.precedingText.endsWith(alignBusinessHeading));
  demand(
    business.precedingText.includes(
      "Our Scanner segment consists of intraoral scanning systems, additional services and ancillary products"
    )
  );
  const labels = (t: typeof primary, i: number) =>
    t.rows[i].cells.filter((c) => c.label).map((c) => c.label);
  demand(canonical(labels(primary, 2)) === canonical(["Year Ended December 31,"]));
  demand(canonical(labels(primary, 7)) === canonical(["Operating expenses:"]));
  demand(canonical(labels(business, 2)) === canonical(["For the Year Ended December 31,"]));
  demand(canonical(labels(business, 4)) === canonical(["Net revenues"]));
  for (const t of [primary, business])
    for (const row of t.rows.slice(0, 2)) demand(row.cells.every((c) => !c.label));
  for (const year of [2018, 2017, 2016]) {
    const selections = alignStandaloneSelections(year, primary.tableIndex, business.tableIndex);
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
  const totals = alignStandaloneMetrics(p, joins[0]);
  demand(proof.primaryProfile === undefined || proof.primaryProfile === "income-statement");
  if (proof.primaryProfile) demand(canonical(p.metricSources) === canonical(totals.metricSources));
  for (const [key, value] of Object.entries(totals.metrics)) {
    const k = key as keyof PeriodV2["metrics"];
    if (proof.primaryProfile || p.metrics[k] !== undefined)
      demand(p.metrics[k] === value, `Original ${key} differs from preserved amount`);
  }
  demand(
    p.metrics.revenue === totals.metrics.revenue &&
      p.metrics.equityMethodIncome === totals.metrics.equityMethodIncome &&
      p.metricSources.revenue?.tag === revenueTag &&
      p.metricSources.revenue.method === "reported"
  );
  return joins[1].monetaryRows.slice(0, 2).map((r, i) => ({
    id: `reported-${businessBindings[i][2].split(":")[1]}`,
    label: businessBindings[i][1],
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
      columnLabel: String(p.fiscalYear)
    }
  }));
}
export function alignStandaloneProblem(p: PeriodV2) {
  try {
    const e = p.businessBreakdownSource,
      proof = e?.standaloneRevenue;
    demand(
      e?.method === "reviewed-original-standalone-revenue" &&
        proof &&
        e.ruleId === alignStandaloneRule &&
        e.ruleId === proof!.ruleId &&
        e.tableIndex === proof!.source.tables[1].tableIndex &&
        e.totalTableIndex === proof!.source.tables[0].tableIndex &&
        e.sourceUrl === p.sourceUrl &&
        e.accession === p.accession &&
        e.revenue === p.metrics.revenue &&
        e.revenueTag === p.metricSources.revenue?.tag &&
        e.revenueDecimals === -3 &&
        e.totalLabel === "Total net revenues" &&
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
        p.segmentBasis === alignStandaloneBasis
    );
    demand(canonical(p.segments) === canonical(alignStandaloneSegments(p, proof!)));
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Align Technology proof";
  }
}
