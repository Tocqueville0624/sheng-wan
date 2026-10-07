import type { PeriodV2 } from "./v2-types";
import type { OriginalStandaloneBusinessProof } from "./standalone-business";
import type { OriginalStandaloneTableSelection } from "./standalone-revenue-rows";
import { replayOriginalStandaloneRevenueTable } from "./standalone-revenue-rows";
import { replayOriginalStandaloneSourceProof } from "./standalone-source-proof";
import type { RevenueSegment } from "./types";

export const unitedHealthStandaloneRule = "unh-original-separate-primary-revenue-v1";
export const unitedHealthStandaloneBasis =
  "Reported original UnitedHealth premiums, products, services, and investment and other income in the complete primary statement. These consolidated revenue sources exclude affiliated segment sales; original XML declarations, million-dollar display units, all annual columns and income identities are preserved. No residual revenue or business gross profit is estimated.";
const demand = (
  condition: unknown,
  message = "Changed original UnitedHealth primary statement"
) => {
  if (!condition) throw Error(message);
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
// Exact original 2018 primary row concepts and display signs. No amounts are kept here.
const bindings = [
  [5, "Premiums", "us-gaap:PremiumsEarnedNet", "same"],
  [6, "Products", "unh:SalesRevenueProductsNet", "same"],
  [7, "Services", "unh:SalesRevenuesServicesNet", "same"],
  [8, "Investment and other income", "us-gaap:InvestmentIncomeInterestAndDividend", "same"],
  [9, "Total revenues", "us-gaap:Revenues", "same"],
  [11, "Medical costs", "us-gaap:PolicyholderBenefitsAndClaimsIncurredHealthCare", "same"],
  [12, "Operating costs", "us-gaap:SellingGeneralAndAdministrativeExpense", "same"],
  [13, "Cost of products sold", "us-gaap:CostOfGoodsAndServicesSold", "same"],
  [14, "Depreciation and amortization", "us-gaap:DepreciationAndAmortization", "same"],
  [15, "Total operating costs", "us-gaap:CostsAndExpenses", "same"],
  [16, "Earnings from operations", "us-gaap:OperatingIncomeLoss", "same"],
  [17, "Interest expense", "us-gaap:InterestExpense", "opposite"],
  [
    18,
    "Earnings before income taxes",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "same"
  ],
  [19, "Provision for income taxes", "us-gaap:IncomeTaxExpenseBenefit", "opposite"],
  [20, "Net earnings", "us-gaap:ProfitLoss", "same"],
  [
    21,
    "Earnings attributable to noncontrolling interests",
    "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
    "opposite"
  ],
  [
    22,
    "Net earnings attributable to UnitedHealth Group common shareholders",
    "us-gaap:NetIncomeLoss",
    "same"
  ]
] as const;
export function unitedHealthStandaloneSelection(
  year: number,
  tableIndex: number
): OriginalStandaloneTableSelection {
  demand([2016, 2017, 2018].includes(year));
  return {
    tableIndex,
    scale: 6,
    units: { rowIndex: 3, label: "(in millions, except per share data)" },
    headers: {
      rowIndex: 3,
      labels: ["2018", "2017", "2016"],
      selectedIndex: 2018 - year,
      prefixLabel: "(in millions, except per share data)"
    },
    calendarYear: year,
    period: { startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    rows: bindings.map(([rowIndex, label, tag, displayPolarity]) => ({
      rowIndex,
      label,
      tag,
      displayPolarity,
      dimensions: {},
      columns: [
        { columnIndex: 2, span: 3 },
        { columnIndex: 6, span: 3 },
        { columnIndex: 10, span: 3 }
      ]
    }))
  };
}
type Join = ReturnType<typeof replayOriginalStandaloneRevenueTable>;
function checkIncome(join: Join) {
  const v = (row: number) => join.monetaryRows.find((r) => r.rowIndex === row)!.originalFact.value;
  demand([5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17].every((r) => v(r) >= 0));
  demand(
    v(5) + v(6) + v(7) + v(8) === v(9),
    "Original comparative revenue categories do not reconcile"
  );
  demand(v(11) + v(12) + v(13) + v(14) === v(15), "Original operating costs do not reconcile");
  demand(v(9) - v(15) === v(16));
  demand(v(16) - v(17) === v(18));
  demand(v(18) - v(19) === v(20));
  demand(v(20) - v(21) === v(22));
}
export function unitedHealthStandaloneMetrics(
  p: Pick<PeriodV2, "sourceUrl" | "accession" | "filedAt">,
  join: Join
): Pick<PeriodV2, "metrics" | "metricSources"> {
  checkIncome(join);
  const metrics: PeriodV2["metrics"] = {},
    metricSources: PeriodV2["metricSources"] = {};
  const keys = [
    ["revenue", 9],
    ["totalOperatingCosts", 15],
    ["operatingIncome", 16],
    ["pretaxIncome", 18],
    ["incomeTax", 19],
    ["noncontrollingInterestIncome", 21],
    ["netIncome", 22]
  ] as const;
  for (const [key, index] of keys) {
    const r = join.monetaryRows.find((r) => r.rowIndex === index)!;
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
export function unitedHealthStandaloneCostDetails(
  join: Join
): NonNullable<PeriodV2["operatingCostDetails"]> {
  checkIncome(join);
  return join.monetaryRows
    .filter((r) => r.rowIndex >= 11 && r.rowIndex <= 14)
    .map((r) => ({
      id: `line-${r.originalFact.tag.split(":")[1]}`,
      label: r.label,
      amount: r.originalFact.value,
      tag: r.originalFact.tag,
      decimals: r.originalFact.decimals
    }));
}
export function unitedHealthStandaloneSegments(
  p: PeriodV2,
  proof: OriginalStandaloneBusinessProof
): RevenueSegment[] {
  const s = proof.source;
  demand(
    proof.ruleId === unitedHealthStandaloneRule &&
      s.cik === "0000731766" &&
      proof.form === "10-K" &&
      proof.reportDate === "2018-12-31" &&
      p.kind === "annual" &&
      [2016, 2017, 2018].includes(p.fiscalYear) &&
      p.startDate === `${p.fiscalYear}-01-01` &&
      p.endDate === `${p.fiscalYear}-12-31` &&
      p.sourceUrl === s.primarySource.url &&
      p.accession === s.accession &&
      s.accession === "0000731766-19-000005" &&
      proof.reportDate <= p.filedAt &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.revenueAdjustments?.length &&
      s.tables.length === 1
  );
  const replay = replayOriginalStandaloneSourceProof(s),
    instance = replay.instance,
    table = s.tables[0];
  for (const [prefix, uri] of Object.entries({
    "us-gaap": "http://fasb.org/us-gaap/2018-01-31",
    srt: "http://fasb.org/srt/2018-01-31",
    dei: "http://xbrl.sec.gov/dei/2018-01-31",
    unh: "http://www.uhc.com/20181231"
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
    instance.contexts.every((c) => Number(c.cik) === 731766 && !c.typed && !c.unreviewedScope)
  );
  demand(
    canonical(table.selection) ===
      canonical(unitedHealthStandaloneSelection(p.fiscalYear, table.tableIndex))
  );
  // Bind every original primary heading and income row; MD&A change columns and
  // gross affiliated division tables cannot substitute for this primary ledger.
  demand(
    table.rows.length === 30 &&
      table.precedingText.endsWith("UnitedHealth Group Consolidated Statements of Operations")
  );
  demand(
    table.rows[2].cells
      .filter((c) => c.label)
      .map((c) => c.label)
      .join("") === "For the Years Ended December 31,"
  );
  demand(
    table.rows[4].cells
      .filter((c) => c.label)
      .map((c) => c.label)
      .join("") === "Revenues:"
  );
  demand(
    table.rows[10].cells
      .filter((c) => c.label)
      .map((c) => c.label)
      .join("") === "Operating costs:"
  );
  for (const row of table.rows.slice(0, 3).filter((r) => r.rowIndex !== 2))
    demand(row.cells.every((c) => !c.label));
  for (const year of [2018, 2017, 2016])
    checkIncome(
      replayOriginalStandaloneRevenueTable(
        { cik: s.cik, instance },
        table,
        unitedHealthStandaloneSelection(year, table.tableIndex)
      )
    );
  const primary = replay.joins[0],
    totals = unitedHealthStandaloneMetrics(p, primary);
  demand(proof.primaryProfile === undefined || proof.primaryProfile === "income-statement");
  if (p.operatingCostDetails)
    demand(
      canonical(p.operatingCostDetails) === canonical(unitedHealthStandaloneCostDetails(primary))
    );
  if (proof.primaryProfile)
    demand(
      canonical(p.metricSources) === canonical(totals.metricSources) &&
        canonical(p.operatingCostDetails) === canonical(unitedHealthStandaloneCostDetails(primary))
    );
  for (const [key, value] of Object.entries(totals.metrics)) {
    const k = key as keyof PeriodV2["metrics"];
    if (proof.primaryProfile || p.metrics[k] !== undefined)
      demand(p.metrics[k] === value, `Original ${key} differs from preserved financial amount`);
  }
  demand(
    p.metrics.revenue === totals.metrics.revenue &&
      p.metricSources.revenue?.tag === "us-gaap:Revenues" &&
      p.metricSources.revenue.method === "reported"
  );
  return primary.monetaryRows.slice(0, 4).map((r) => ({
    id: `reported-${r.label.replace(/[^A-Za-z0-9]+/g, "-")}`,
    label: r.label,
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
      rowLabel: r.label
    }
  }));
}
export function unitedHealthStandaloneProblem(p: PeriodV2) {
  try {
    const envelope = p.businessBreakdownSource,
      proof = envelope?.standaloneRevenue;
    demand(
      envelope?.method === "reviewed-original-standalone-revenue" &&
        proof &&
        envelope.ruleId === unitedHealthStandaloneRule &&
        envelope.ruleId === proof!.ruleId &&
        envelope.tableIndex === proof!.source.tables[0].tableIndex &&
        envelope.totalTableIndex === envelope.tableIndex &&
        envelope.sourceUrl === p.sourceUrl &&
        envelope.accession === p.accession &&
        envelope.revenue === p.metrics.revenue &&
        envelope.revenueTag === p.metricSources.revenue?.tag &&
        envelope.revenueDecimals === -6 &&
        envelope.totalLabel === "Total revenues" &&
        !envelope.axis &&
        !envelope.qualifiers &&
        !envelope.ametekRevenue &&
        !envelope.albemarleRevenue &&
        !envelope.productPortfolios &&
        !envelope.serviceRevenueRows &&
        !envelope.externalCustomerColumns &&
        !envelope.originalRevenueRows &&
        !envelope.omittedSubtotals.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === unitedHealthStandaloneBasis
    );
    demand(canonical(p.segments) === canonical(unitedHealthStandaloneSegments(p, proof!)));
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed UnitedHealth original proof";
  }
}
