import {
  unitedHealthStandaloneRule,
  unitedHealthStandaloneBasis,
  unitedHealthStandaloneSegments,
  unitedHealthStandaloneProblem,
  unitedHealthStandaloneMetrics
} from "./unitedhealth-standalone";
import type { OriginalStandaloneSourceProof } from "./standalone-source-proof";
import { replayOriginalStandaloneSourceProof } from "./standalone-source-proof";
import type { OriginalStandaloneTableSelection } from "./standalone-revenue-rows";
import type { PeriodV2 } from "./v2-types";
import type { RevenueSegment } from "./types";

export type OriginalStandaloneBusinessProof = {
  ruleId:
    | "alb-original-separate-revenue-v1"
    | "ame-original-separate-closing-sales-v1"
    | "unh-original-separate-primary-revenue-v1";
  reportDate: string;
  form: string;
  /** Only a first-import seed uses the complete reviewed primary metric profile. */
  primaryProfile?: "income-statement";
  source: OriginalStandaloneSourceProof;
};
function demand(value: unknown, reason: string): asserts value {
  if (!value) throw Error(reason);
}
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const primaryAlbemarle = [
  [4, "Net sales", "us-gaap:Revenues", "same"],
  [5, "Cost of goods sold", "us-gaap:CostOfRevenue", "same"],
  [6, "Gross profit", "us-gaap:GrossProfit", "same"],
  [
    7,
    "Selling, general and administrative expenses",
    "us-gaap:SellingGeneralAndAdministrativeExpense",
    "same"
  ],
  [8, "Research and development expenses", "us-gaap:ResearchAndDevelopmentExpense", "same"],
  [9, "Gain on sales of businesses, net", "us-gaap:GainLossOnSaleOfBusiness", "opposite"],
  [
    10,
    "Acquisition and integration related costs",
    "us-gaap:BusinessCombinationAcquisitionRelatedCosts",
    "same"
  ],
  [11, "Operating profit", "us-gaap:OperatingIncomeLoss", "same"],
  [12, "Interest and financing expenses", "us-gaap:InterestAndDebtExpense", "opposite"],
  [13, "Other expenses, net", "us-gaap:OtherNonoperatingIncomeExpense", "same"],
  [
    14,
    "Income from continuing operations before income taxes and equity in net income of unconsolidated investments",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "same"
  ],
  [15, "Income tax expense", "us-gaap:IncomeTaxExpenseBenefit", "same"],
  [
    16,
    "Income from continuing operations before equity in net income of unconsolidated investments",
    "alb:IncomeBeforeEquityInNetIncomeOfUnconsolidatedInvestments",
    "same"
  ],
  [
    17,
    "Equity in net income of unconsolidated investments (net of tax)",
    "us-gaap:IncomeLossFromEquityMethodInvestments",
    "same"
  ],
  [
    18,
    "Net income from continuing operations",
    "us-gaap:IncomeLossFromContinuingOperationsIncludingPortionAttributableToNoncontrollingInterest",
    "same"
  ],
  [
    19,
    "Income from discontinued operations (net of tax)",
    "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
    "same"
  ],
  [20, "Net income", "us-gaap:ProfitLoss", "same"],
  [
    21,
    "Net income attributable to noncontrolling interests",
    "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
    "opposite"
  ],
  [22, "Net income attributable to Albemarle Corporation", "us-gaap:NetIncomeLoss", "same"]
] as const;
const albLabels = ["Lithium", "Bromine Specialties", "Catalysts", "All Other", "Corporate"];
const primaryAmetek = [
  [3, "Net sales", "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax", "revenue"],
  [5, "Cost of sales", "us-gaap:CostOfGoodsAndServicesSold", "costOfRevenue"],
  [8, "Total operating expenses", "us-gaap:CostsAndExpenses", "totalOperatingCosts"],
  [11, "Operating income", "us-gaap:OperatingIncomeLoss", "operatingIncome"],
  [
    15,
    "Income before income taxes",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "pretaxIncome"
  ],
  [16, "Provision for income taxes", "us-gaap:IncomeTaxExpenseBenefit", "incomeTax"],
  [18, "Net income", "us-gaap:NetIncomeLoss", "netIncome"]
] as const;
const albDimensions = (i: number): Record<string, string> => {
  if (i < 3)
    return {
      "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
      "us-gaap:StatementBusinessSegmentsAxis": `alb:${["Lithium", "BromineSpecialties", "Catalysts"][i]}Member`
    };
  if (i === 3) return { "srt:ConsolidationItemsAxis": "us-gaap:MaterialReconcilingItemsMember" };
  if (i === 4) return { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" };
  return {};
};
/** Reviewed layouts contain only original labels, QNames, scope and geometry.
 * No financial value or residual is part of these issuer rules. */
export function originalStandaloneBusinessSelections(
  cik: string,
  reportYear: number,
  year: number,
  primaryIndex: number,
  businessIndex: number,
  primaryProfile?: "income-statement"
): OriginalStandaloneTableSelection[] {
  demand(
    ["0000915913", "0001037868"].includes(cik) &&
      reportYear === 2018 &&
      year >= reportYear - 2 &&
      year <= reportYear &&
      primaryIndex !== businessIndex,
    "Unreviewed original separate annual classification."
  );
  const period = { startDate: `${year}-01-01`, endDate: `${year}-12-31` },
    years = [String(reportYear), String(reportYear - 1), String(reportYear - 2)];
  if (cik === "0000915913") {
    const columns = [
      { columnIndex: 1, span: 3 },
      { columnIndex: 5, span: 3 },
      { columnIndex: 9, span: 3 }
    ];
    return [
      {
        tableIndex: primaryIndex,
        calendarYear: year,
        period,
        units: { rowIndex: 2, label: "(In Thousands, Except Per Share Amounts)" },
        headers: {
          rowIndex: 3,
          labels: years,
          prefixLabel: "Year Ended December 31",
          selectedIndex: reportYear - year
        },
        rows: primaryAlbemarle.map(([rowIndex, label, tag, displayPolarity]) => ({
          rowIndex,
          label,
          tag,
          displayPolarity,
          dimensions: {},
          columns
        }))
      },
      {
        tableIndex: businessIndex,
        calendarYear: year,
        period,
        units: { rowIndex: 4, label: "(In thousands)" },
        headers: { rowIndex: 3, labels: years, selectedIndex: reportYear - year },
        rows: [...albLabels, "Total net sales"].map((label, i) => ({
          rowIndex: 6 + i,
          label,
          tag: "us-gaap:Revenues",
          dimensions: albDimensions(i),
          columns
        }))
      }
    ];
  }
  const columns = [
      { columnIndex: 2, span: 3 },
      { columnIndex: 6, span: 3 },
      { columnIndex: 10, span: 3 }
    ],
    tag = "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax";
  return [
    {
      tableIndex: primaryIndex,
      calendarYear: year,
      period,
      units: {
        precedingTextSuffix:
          "Consolidated Statement of Income (In thousands, except per share amounts)"
      },
      headers: { rowIndex: 2, labels: years, selectedIndex: reportYear - year },
      rows:
        primaryProfile === "income-statement"
          ? primaryAmetek.map(([rowIndex, label, tag]) => ({
              rowIndex,
              label,
              tag,
              dimensions: {},
              columns
            }))
          : [
              { rowIndex: 3, label: "Net sales", tag, dimensions: {}, columns },
              {
                rowIndex: 16,
                label: "Provision for income taxes",
                tag: "us-gaap:IncomeTaxExpenseBenefit",
                dimensions: {},
                columns
              }
            ]
    },
    {
      tableIndex: businessIndex,
      calendarYear: year,
      period,
      units: { rowIndex: 3, label: "(In thousands)" },
      yearHeader: { rowIndex: 1, label: String(year) },
      headers: { rowIndex: 2, labels: ["EIG", "EMG", "Total"], selectedIndex: 0 },
      rows: [0, 1, 2].map<OriginalStandaloneTableSelection["rows"][number]>((i) => ({
        rowIndex: 22,
        label: "Consolidated net sales",
        tag,
        columns,
        selectedColumn: i,
        dimensions: (i < 2
          ? {
              "us-gaap:StatementBusinessSegmentsAxis": `ame:${["ElectronicInstrumentsGroup", "ElectromechanicalGroup"][i]}Member`
            }
          : {}) as Record<string, string>
      }))
    }
  ];
}
export const originalStandaloneBusinessBasis = (
  ruleId: OriginalStandaloneBusinessProof["ruleId"]
) =>
  ruleId === unitedHealthStandaloneRule
    ? unitedHealthStandaloneBasis
    : ruleId === "alb-original-separate-revenue-v1"
      ? "Reported original Albemarle business and corporate net sales. The complete five-category revenue section reconciles to the independently reported primary net sales, preserving original XML scopes, signs, precision and fiscal columns. No residual or business gross profit is estimated."
      : "Reported original AMETEK EIG/EMG consolidated closing sales in the geography-by-business table, independently matched to the primary statement and original XML. Geographic intersections are excluded. For FY2016, the MD&A business disclosure differs by $4,000 in each group; those separate values are not substituted, adjusted or described as a typo. No business gross profit is estimated.";

export function originalStandaloneBusinessSegments(
  p: PeriodV2,
  proof: OriginalStandaloneBusinessProof
): RevenueSegment[] {
  if (proof.ruleId === unitedHealthStandaloneRule) return unitedHealthStandaloneSegments(p, proof);
  const s = proof.source,
    cik = s.cik;
  demand(
    proof.ruleId ===
      (cik === "0000915913"
        ? "alb-original-separate-revenue-v1"
        : cik === "0001037868"
          ? "ame-original-separate-closing-sales-v1"
          : "unsupported") &&
      /^10-K(?:\/A)?$/.test(proof.form) &&
      p.kind === "annual" &&
      p.fiscalYear === Number(p.endDate.slice(0, 4)) &&
      p.startDate === `${p.fiscalYear}-01-01` &&
      p.endDate === `${p.fiscalYear}-12-31` &&
      p.sourceUrl === s.primarySource.url &&
      p.accession === s.accession &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt &&
      !p.revenueAdjustments?.length,
    "Foreign or unreviewed original standalone business source."
  );
  const replay = replayOriginalStandaloneSourceProof(s),
    instance = replay.instance;
  const metadata = (tag: string) => {
    const values = instance.metadata.filter(
      (m) =>
        m.tag === tag &&
        Number(instance.contexts.find((c) => c.id === m.contextId)?.cik) === Number(cik)
    );
    demand(values.length === 1, "Ambiguous original fiscal metadata.");
    return values[0].lexical;
  };
  const reportYear = Number(metadata("dei:DocumentFiscalYearFocus"));
  demand(
    metadata("dei:DocumentPeriodEndDate") === proof.reportDate &&
      metadata("dei:DocumentFiscalPeriodFocus") === "FY" &&
      proof.reportDate === `${reportYear}-12-31` &&
      instance.namespaces["us-gaap"] === "http://fasb.org/us-gaap/2018-01-31" &&
      instance.namespaces["srt"] === "http://fasb.org/srt/2018-01-31" &&
      instance.namespaces["dei"] === "http://xbrl.sec.gov/dei/2018-01-31" &&
      instance.namespaces[cik === "0000915913" ? "alb" : "ame"] ===
        (cik === "0000915913"
          ? "http://www.albemarle.com/20181231"
          : "http://www.amtexinc.com/20181231") &&
      instance.contexts.every(
        (c) => Number(c.cik) === Number(cik) && !c.typed && !c.unreviewedScope
      ) &&
      s.tables.length === 2,
    "Changed original taxonomy, issuer, report period or source scope."
  );
  const expected = originalStandaloneBusinessSelections(
    cik,
    reportYear,
    p.fiscalYear,
    s.tables[0].tableIndex,
    s.tables[1].tableIndex,
    proof.primaryProfile
  );
  demand(
    canonical(s.tables.map((t) => t.selection)) === canonical(expected),
    "Original standalone physical layout or business classification was altered."
  );
  const [primary, business] = replay.joins,
    revenue = primary.monetaryRows.find((r) => r.label === "Net sales")!.originalFact,
    tax = primary.monetaryRows.find(
      (r) =>
        r.label === (cik === "0000915913" ? "Income tax expense" : "Provision for income taxes")
    )!.originalFact;
  const metric = p.metricSources.revenue;
  demand(
    metric?.method === "reported" &&
      metric.sourceUrl === p.sourceUrl &&
      metric.accession === p.accession &&
      metric.filedAt === p.filedAt &&
      metric.tag === revenue.tag &&
      p.metrics.revenue === revenue.value &&
      p.metrics.incomeTax === tax.value,
    "Original independent primary revenue or tax differs from preserved metrics."
  );
  demand(
    proof.primaryProfile === undefined || proof.primaryProfile === "income-statement",
    "Unknown original primary metric profile."
  );
  if (proof.primaryProfile === "income-statement") {
    const reported = originalStandaloneReportedMetrics(p, cik, primary);
    demand(
      canonical(p.metrics) === canonical(reported.metrics) &&
        canonical(p.metricSources) === canonical(reported.metricSources),
      "Original primary metrics or their provenance were altered."
    );
  }
  if (cik === "0000915913")
    demand(
      /Albemarle Corporation and Subsidiaries CONSOLIDATED STATEMENTS OF INCOME$/.test(
        primary.precedingText
      ),
      "Missing original Albemarle primary statement title."
    );
  const branches = business.monetaryRows.slice(0, -1),
    total = business.monetaryRows.at(-1)!.originalFact;
  demand(
    branches.length === (cik === "0000915913" ? 5 : 2) &&
      total.value === revenue.value &&
      branches.every((r) => r.originalFact.value >= 0) &&
      branches.reduce((sum, r) => sum + r.originalFact.value, 0) === total.value,
    "Original complete business section does not reconcile to independent primary revenue."
  );
  return branches.map((r, i) => {
    const label =
        cik === "0000915913" ? albLabels[i] : ["Electronic Instruments", "Electromechanical"][i],
      f = r.originalFact;
    return {
      id: `reported-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
      label,
      revenue: f.value,
      revenueSource: {
        sourceUrl: p.sourceUrl,
        accession: p.accession!,
        filedAt: p.filedAt,
        startDate: p.startDate,
        endDate: p.endDate,
        currency: "USD",
        tag: f.tag,
        dimensions: f.context.dimensions,
        value: f.value,
        decimals: f.decimals,
        rowLabel: r.label,
        rowIndex: r.rowIndex,
        columnIndex: r.originalCells.find((c) => /\d/.test(c.label))!.columnIndex,
        tableLabel: cik === "0000915913" ? r.label : ["EIG", "EMG"][i]
      }
    };
  });
}

/** Reported metrics retain their original joined primary facts. ALB's net
 * expense sum explicitly combines its original signed rows; no residual expense,
 * unreported gross profit, missing zero or declared calculation precision. */
export function originalStandaloneReportedMetrics(
  p: Pick<PeriodV2, "sourceUrl" | "accession" | "filedAt">,
  cik: string,
  primary: ReturnType<typeof replayOriginalStandaloneSourceProof>["joins"][number]
): Pick<PeriodV2, "metrics" | "metricSources"> {
  if (cik === "0000731766") return unitedHealthStandaloneMetrics(p, primary);
  const bindings: readonly (readonly [keyof PeriodV2["metrics"], string])[] =
    cik === "0001037868"
      ? primaryAmetek.map(([, label, , key]) => [key, label] as const)
      : [
          ["revenue", "Net sales"],
          ["costOfRevenue", "Cost of goods sold"],
          ["grossProfit", "Gross profit"],
          ["sellingGeneralAndAdministrative", "Selling, general and administrative expenses"],
          ["researchAndDevelopment", "Research and development expenses"],
          ["operatingIncome", "Operating profit"],
          [
            "pretaxIncome",
            "Income from continuing operations before income taxes and equity in net income of unconsolidated investments"
          ],
          ["incomeTax", "Income tax expense"],
          ["equityMethodIncome", "Equity in net income of unconsolidated investments (net of tax)"],
          ["discontinuedOperationsIncome", "Income from discontinued operations (net of tax)"],
          ["noncontrollingInterestIncome", "Net income attributable to noncontrolling interests"],
          ["netIncome", "Net income attributable to Albemarle Corporation"]
        ];
  demand(["0000915913", "0001037868"].includes(cik), "Unreviewed original primary metrics.");
  const metrics: PeriodV2["metrics"] = {},
    metricSources: PeriodV2["metricSources"] = {};
  for (const [key, label] of bindings) {
    const rows = primary.monetaryRows.filter((r) => r.label === label);
    demand(rows.length === 1, "Missing or ambiguous original primary metric.");
    const f = rows[0].originalFact;
    demand(
      !Object.keys(f.context.dimensions).length && f.currency === "USD",
      "Original primary metric is not consolidated USD."
    );
    metrics[key] = f.value;
    metricSources[key] = {
      label,
      tag: f.tag,
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      method: "reported",
      decimals: f.decimals
    };
  }
  if (cik === "0000915913") {
    const costs = primary.monetaryRows.filter((r) => [7, 8, 9, 10].includes(r.rowIndex));
    demand(costs.length === 4, "Incomplete original operating expense section.");
    metrics.operatingExpenses = costs.reduce((sum, r) => sum + r.displayedWholeDollarValue, 0);
    metricSources.operatingExpenses = {
      label: "Sum of original operating expense and business-sale gain lines (net)",
      tag: costs.map((r) => r.originalFact.tag).join(" + "),
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      method: "calculated",
      inputs: costs.map(
        (r) =>
          `${r.label} (${r.originalFact.tag}, displayed effect ${r.displayedWholeDollarValue}): ${p.sourceUrl}`
      )
    };
  }
  return { metrics, metricSources };
}

export function originalStandaloneBusinessProblem(p: PeriodV2): string | undefined {
  if (p.businessBreakdownSource?.ruleId === unitedHealthStandaloneRule)
    return unitedHealthStandaloneProblem(p);
  try {
    const s = p.businessBreakdownSource,
      proof = s?.standaloneRevenue;
    demand(
      s?.method === "reviewed-original-standalone-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.tableIndex === proof.source.tables[1].tableIndex &&
        s.totalTableIndex === proof.source.tables[0].tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.revenueDecimals === -3 &&
        s.totalLabel ===
          (proof.source.cik === "0000915913" ? "Total net sales" : "Consolidated net sales") &&
        !s.axis &&
        !s.qualifiers &&
        !s.ametekRevenue &&
        !s.albemarleRevenue &&
        !s.productPortfolios &&
        !s.serviceRevenueRows &&
        !s.externalCustomerColumns &&
        !s.omittedSubtotals.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === originalStandaloneBusinessBasis(proof.ruleId),
      "Invalid original standalone business proof envelope."
    );
    demand(
      canonical(p.segments) === canonical(originalStandaloneBusinessSegments(p, proof)),
      "Original standalone business amounts, positions or classification were altered."
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original standalone business proof.";
  }
}
