import type { DirectNetItems, FinancialPeriod } from "./types";
import type { MetricSource } from "./v2-types";

/** Reviewed ARE source meanings, never stored financial values. */
export const directNetRule = {
  id: "are-direct-net-v1",
  cik: "0001035443",
  revenueTag: "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  expenseTags: [
    "us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment",
    "us-gaap:GeneralAndAdministrativeExpense",
    "us-gaap:InterestExpense",
    "us-gaap:DepreciationAndAmortization",
    "us-gaap:ImpairmentOfRealEstate"
  ],
  gainTags: [
    "us-gaap:IncomeLossFromEquityMethodInvestments",
    "us-gaap:EquitySecuritiesFvNiGainLoss",
    "us-gaap:GainsLossesOnExtinguishmentOfDebt",
    "us-gaap:GainLossOnSaleOfProperties",
    "are:GainLossOnSaleOfRentalPropertiesNetOfApplicableIncomeTaxes",
    "us-gaap:GainLossOnSaleOfPropertiesNetOfApplicableIncomeTaxes"
  ]
} as const;

export function directNetMeaning(tag: string, label: string, expenseSection: boolean) {
  if ((directNetRule.expenseTags as readonly string[]).includes(tag))
    return expenseSection ? "cost" : undefined;
  if (!(directNetRule.gainTags as readonly string[]).includes(tag)) return;
  // A debt gain is either subtracted in the expense section or reported after
  // that subtotal. Its original sign is retained in both source presentations.
  if (expenseSection && tag !== "us-gaap:GainsLossesOnExtinguishmentOfDebt") return;
  if (
    (tag === "us-gaap:EquitySecuritiesFvNiGainLoss" &&
      !/^Investment (?:income(?: \(loss(?:es)?\))?|loss|\(loss\) income)$/i.test(label)) ||
    (tag === "us-gaap:GainsLossesOnExtinguishmentOfDebt" &&
      !/^(?:Gain|Loss|Gain \(loss\)|Loss \(gain\)) on early extinguishment of debt$/i.test(
        label
      )) ||
    (tag === "us-gaap:GainLossOnSaleOfProperties" &&
      !/^(?:Gain(?: \(loss\))?|\(Loss\) gain) on sales of real estate$/i.test(label)) ||
    (tag === "are:GainLossOnSaleOfRentalPropertiesNetOfApplicableIncomeTaxes" &&
      !/^Gain on sales of real estate(?: [–-] rental properties)?$/i.test(label)) ||
    (tag === "us-gaap:GainLossOnSaleOfPropertiesNetOfApplicableIncomeTaxes" &&
      !/^Gain on sales of real estate [–-] land parcels$/i.test(label)) ||
    (tag === "us-gaap:IncomeLossFromEquityMethodInvestments" &&
      !/^Equity in .*unconsolidated real estate joint ventures$/i.test(label))
  )
    return;
  return "gain";
}

export const directNetAllocationTags = new Set([
  "us-gaap:DividendsPreferredStock",
  "us-gaap:PreferredStockAccretionOfRedemptionDiscount"
]);

type SourcePeriod = Omit<FinancialPeriod, "metrics" | "displayCurrency"> & {
  displayCurrency: string;
  metrics: Partial<FinancialPeriod["metrics"]>;
  metricSources?: Partial<Record<keyof FinancialPeriod["metrics"], MetricSource>>;
};

export function directNetItemsProblem(period: SourcePeriod) {
  const p = period.directNetItems;
  if (!p) return;
  const valid = (l: DirectNetItems["revenue"]) =>
    !!l.id &&
    !!l.label &&
    !!l.tag &&
    Number.isFinite(l.amount) &&
    Number.isInteger(l.decimals) &&
    Number.isInteger(l.rowIndex) &&
    l.rowIndex >= 0 &&
    !Object.keys(l.dimensions ?? {}).length;
  const same = (
    key: "revenue" | "totalExpenses" | "netIncome" | "noncontrollingInterestIncome",
    l: DirectNetItems["revenue"]
  ) => {
    const s = period.metricSources?.[key];
    return (
      period.metrics[key] === l.amount &&
      s?.method === "reported" &&
      s.tag === l.tag &&
      s.decimals === l.decimals &&
      s.sourceUrl === period.sourceUrl &&
      s.accession === period.accession &&
      s.filedAt === period.filedAt
    );
  };
  const tol = Math.max(1e-6, Math.abs(p.revenue.amount) * 1e-9);
  const expenseSum = p.expenseItems.reduce(
    (s, l) => s + (l.effect === "cost" ? l.amount : -l.amount),
    0
  );
  const gains = p.gains.reduce((s, l) => s + l.amount, 0);
  const lines = [
    p.revenue,
    ...p.expenseItems,
    p.expenses,
    ...p.gains,
    p.consolidated,
    p.noncontrolling,
    p.parent
  ];
  if (
    p.ruleId !== directNetRule.id ||
    !/^\d{10}-\d{2}-\d{6}$/.test(p.accession) ||
    !period.sourceUrl.startsWith(
      `https://www.sec.gov/Archives/edgar/data/${Number(directNetRule.cik)}/${p.accession.replaceAll("-", "")}/`
    ) ||
    p.sourceUrl !== period.sourceUrl ||
    p.accession !== period.accession ||
    p.filedAt !== period.filedAt ||
    p.startDate !== period.startDate ||
    p.endDate !== period.endDate ||
    p.currency !== "USD" ||
    period.reportingCurrency !== "USD" ||
    period.displayCurrency !== "USD" ||
    !Number.isInteger(p.tableIndex) ||
    p.tableIndex < 0 ||
    lines.some((l, i) => !valid(l) || l.rowIndex !== p.revenue.rowIndex + i) ||
    p.expenseItems.length > directNetRule.expenseTags.length + 1 ||
    p.gains.length > directNetRule.gainTags.length ||
    new Set(lines.map((l) => l.id)).size !== lines.length ||
    new Set(lines.map((l) => l.tag)).size !== lines.length ||
    p.revenue.tag !== directNetRule.revenueTag ||
    p.expenses.tag !== "us-gaap:CostsAndExpenses" ||
    p.consolidated.tag !== "us-gaap:ProfitLoss" ||
    p.parent.tag !== "us-gaap:NetIncomeLoss" ||
    p.noncontrolling.tag !== "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest" ||
    p.revenue.amount <= 0 ||
    p.expenses.amount < 0 ||
    !p.expenseItems.length ||
    !p.gains.length ||
    !same("revenue", p.revenue) ||
    !same("totalExpenses", p.expenses) ||
    !same("netIncome", p.parent) ||
    !same("noncontrollingInterestIncome", p.noncontrolling) ||
    p.expenseItems.some(
      (l) =>
        directNetMeaning(l.tag!, l.label, true) !== l.effect ||
        (l.effect === "cost" && l.amount < 0)
    ) ||
    p.gains.some((l) => directNetMeaning(l.tag!, l.label, false) !== "gain") ||
    Math.abs(expenseSum - p.expenses.amount) > tol ||
    Math.abs(p.revenue.amount - p.expenses.amount + gains - p.consolidated.amount) > tol ||
    Math.abs(p.consolidated.amount - p.noncontrolling.amount - p.parent.amount) > tol ||
    (
      [
        "grossProfit",
        "costOfRevenue",
        "operatingIncome",
        "operatingExpenses",
        "totalOperatingCosts",
        "pretaxIncome",
        "incomeTax",
        "expensesAndOtherItems",
        "equityMethodIncome",
        "afterTaxSubsidiaryIncome",
        "discontinuedOperationsIncome"
      ] as const
    ).some((key) => period.metrics[key] !== undefined) ||
    period.operatingItems ||
    period.operatingReconciliation ||
    period.afterTaxReconciliation ||
    period.consolidatedIncomeSubtotal ||
    period.roundedOperatingExpenseComponents ||
    period.operatingExpensesBasis ||
    period.operatingCostDetails?.length ||
    period.operatingExpenseDetails?.length ||
    period.grossProfitAdjustments?.length
  )
    return "The direct net-income statement does not reconcile with its reviewed source ledger.";
}
