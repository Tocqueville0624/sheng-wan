import type { GrossOperatingItems } from "./types";
import type { PeriodV2 } from "./v2-types";

export const flexGrossOperatingRule = {
  id: "flex-gross-operating-costs-v1",
  cik: "0000866374",
  revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  cost: "us-gaap:CostOfGoodsAndServicesSold",
  grossCost: "flex:RestructuringChargesCostOfSales",
  grossProfit: "us-gaap:GrossProfit",
  operatingIncome: "us-gaap:OperatingIncomeLoss"
} as const;

const operatingMeanings = [
  [
    "us-gaap:SellingGeneralAndAdministrativeExpense",
    /^Selling, general and administrative expenses$/i
  ],
  ["us-gaap:AmortizationOfIntangibleAssets", /^Intangible amortization$/i],
  ["flex:RestructuringChargesIndirectCost", /^Restructuring charges$/i],
  [
    "us-gaap:RestructuringSettlementAndImpairmentProvisions",
    /^Restructuring and impairment charges(?: \(reversal\))?$/i
  ]
] as const;

export const flexOperatingCostMeaning = (line: GrossOperatingItems["cost"]) =>
  operatingMeanings.some(([tag, label]) => tag === line.tag && label.test(line.label)) &&
  (line.amount >= 0 ||
    (line.tag === "us-gaap:RestructuringSettlementAndImpairmentProvisions" &&
      /\(reversal\)$/i.test(line.label)));

export const grossOperatingInput = (line: GrossOperatingItems["cost"], url: string) =>
  `${line.label} (${line.tag}): ${url}`;

export const grossOperatingExpenseSum = (p: GrossOperatingItems) =>
  p.operatingCosts.reduce((sum, line) => sum + line.amount, 0);

/** The bound comes only from the original subtotal and each reported source
 * component. A calculated aggregate has no fabricated declared precision. */
export const grossOperatingRoundingBound = (p: GrossOperatingItems) => {
  const lines = [p.grossProfit, ...p.operatingCosts, p.operatingIncome];
  if (lines.some((l) => !Number.isInteger(l.decimals) || Math.abs(l.decimals!) > 15)) return;
  const sum = lines.reduce((bound, l) => bound + 0.5 * 10 ** -l.decimals!, 0);
  return Number.isFinite(sum) ? sum : undefined;
};

type Candidate = Pick<
  PeriodV2,
  | "sourceUrl"
  | "accession"
  | "filedAt"
  | "startDate"
  | "endDate"
  | "displayCurrency"
  | "reportingCurrency"
  | "metrics"
  | "grossOperatingItems"
  | "grossProfitAdjustments"
  | "operatingReconciliation"
  | "operatingExpenseDetails"
  | "operatingExpensesBasis"
  | "operatingItems"
  | "directNetItems"
  | "roundedOperatingExpenseComponents"
> & { metricSources?: PeriodV2["metricSources"] };

export function grossOperatingItemsProblem(period: Candidate): string | undefined {
  const p = period.grossOperatingItems;
  if (!p) return;
  const rule = flexGrossOperatingRule;
  const valid = (l: GrossOperatingItems["cost"]) =>
    !!l.id &&
    !!l.label &&
    !!l.tag &&
    Number.isFinite(l.amount) &&
    Number.isInteger(l.decimals) &&
    Math.abs(l.decimals!) <= 15 &&
    Number.isInteger(l.rowIndex) &&
    l.rowIndex >= 0 &&
    !Object.keys(l.dimensions ?? {}).length;
  const sameReported = (
    key:
      | "revenue"
      | "costOfRevenue"
      | "grossProfit"
      | "operatingIncome"
      | "sellingGeneralAndAdministrative",
    l: GrossOperatingItems["cost"]
  ) => {
    const s = period.metricSources?.[key];
    return (
      period.metrics[key] === l.amount &&
      s?.method === "reported" &&
      s.tag === l.tag &&
      s.decimals === l.decimals &&
      s.label === l.label &&
      s.sourceUrl === p.sourceUrl &&
      s.accession === p.accession &&
      s.filedAt === p.filedAt &&
      !s.inputs?.length
    );
  };
  const ordered = [
    p.revenue,
    p.cost,
    ...p.grossCosts,
    p.grossProfit,
    ...p.operatingCosts,
    p.operatingIncome
  ];
  const sga = p.operatingCosts.find(
    (l) => l.tag === "us-gaap:SellingGeneralAndAdministrativeExpense"
  );
  const amortization = p.operatingCosts.find(
    (l) => l.tag === "us-gaap:AmortizationOfIntangibleAssets"
  );
  const expense = period.metricSources?.operatingExpenses;
  const netExpenses = grossOperatingExpenseSum(p);
  const tolerance = Math.max(1e-6, Math.abs(p.revenue.amount) * 1e-9);
  const difference = p.operatingIncome.amount - (p.grossProfit.amount - netExpenses);
  const rounding = period.operatingReconciliation;
  const bound = grossOperatingRoundingBound(p);
  let source: URL;
  try {
    source = new URL(p.sourceUrl);
  } catch {
    return "Invalid reviewed gross/operating source.";
  }
  if (
    p.ruleId !== rule.id ||
    !/^\d{10}-\d{2}-\d{6}$/.test(p.accession) ||
    source.protocol !== "https:" ||
    source.hostname !== "www.sec.gov" ||
    source.username ||
    source.password ||
    !source.pathname.startsWith(
      `/Archives/edgar/data/${Number(rule.cik)}/${p.accession.replaceAll("-", "")}/`
    ) ||
    p.sourceUrl !== period.sourceUrl ||
    p.accession !== period.accession ||
    p.filedAt !== period.filedAt ||
    p.startDate !== period.startDate ||
    p.endDate !== period.endDate ||
    p.currency !== "USD" ||
    period.displayCurrency !== "USD" ||
    period.reportingCurrency !== "USD" ||
    !Number.isInteger(p.tableIndex) ||
    p.tableIndex < 0 ||
    ordered.some((l) => !valid(l)) ||
    ordered.some((l, i) => i > 0 && l.rowIndex !== ordered[i - 1]!.rowIndex + 1) ||
    new Set(ordered.map((l) => l.id)).size !== ordered.length ||
    new Set(p.operatingCosts.map((l) => l.tag)).size !== p.operatingCosts.length ||
    p.revenue.tag !== rule.revenue ||
    !/^Net sales$/i.test(p.revenue.label) ||
    p.cost.tag !== rule.cost ||
    !/^Cost of sales$/i.test(p.cost.label) ||
    p.cost.amount < 0 ||
    p.grossProfit.tag !== rule.grossProfit ||
    !/^Gross profit$/i.test(p.grossProfit.label) ||
    p.operatingIncome.tag !== rule.operatingIncome ||
    !/^Operating income$/i.test(p.operatingIncome.label) ||
    p.grossCosts.length !== 1 ||
    p.grossCosts.some(
      (l) => l.tag !== rule.grossCost || !/^Restructuring charges$/i.test(l.label) || l.amount < 0
    ) ||
    p.operatingCosts.length < 2 ||
    p.operatingCosts.length > 3 ||
    !sga ||
    !amortization ||
    p.operatingCosts.some((l) => !flexOperatingCostMeaning(l)) ||
    !sameReported("revenue", p.revenue) ||
    !sameReported("costOfRevenue", p.cost) ||
    !sameReported("grossProfit", p.grossProfit) ||
    !sameReported("operatingIncome", p.operatingIncome) ||
    !sameReported("sellingGeneralAndAdministrative", sga) ||
    period.metrics.operatingExpenses !== netExpenses ||
    netExpenses < 0 ||
    expense?.method !== "calculated" ||
    expense.label !== "Sum of reported operating expense lines (net)" ||
    expense.tag !== p.operatingCosts.map((l) => l.tag).join(" + ") ||
    expense.sourceUrl !== p.sourceUrl ||
    expense.accession !== p.accession ||
    expense.filedAt !== p.filedAt ||
    expense.decimals !== undefined ||
    JSON.stringify(expense.inputs) !==
      JSON.stringify(p.operatingCosts.map((l) => grossOperatingInput(l, p.sourceUrl))) ||
    period.operatingExpensesBasis !== "expenses-and-other-items-net" ||
    period.operatingExpenseDetails?.length ||
    period.operatingItems ||
    period.directNetItems ||
    period.roundedOperatingExpenseComponents ||
    Math.abs(p.revenue.amount - p.cost.amount - p.grossCosts[0]!.amount - p.grossProfit.amount) >
      tolerance ||
    JSON.stringify(period.grossProfitAdjustments) !==
      JSON.stringify(
        p.grossCosts.map((l) => ({ label: l.label, amount: -l.amount, sourceUrl: p.sourceUrl }))
      ) ||
    (Math.abs(difference) > tolerance
      ? !rounding ||
        rounding.label !== "Source rounding" ||
        rounding.sourceUrl !== p.sourceUrl ||
        rounding.basis !== "gross-profit" ||
        Math.abs(rounding.amount - difference) > tolerance ||
        bound === undefined ||
        Math.abs(difference) > bound ||
        Math.abs(difference) > p.revenue.amount * 0.001
      : !!rounding)
  )
    return "The reviewed gross and operating source costs do not reconcile.";
}
