import type { FinancialPeriod, OperatingNetItems, StatementLine } from "./types";
import type { MetricSource } from "./v2-types";

/** Finite source-reviewed DLR concepts/captions, never stored amounts. */
export const operatingNetRule = {
  id: "dlr-operating-net-v1",
  cik: "0001297996",
  costs: {
    "us-gaap:OperatingLeaseExpense": /^Rental property operating and maintenance$/i,
    "us-gaap:RealEstateTaxesAndInsurance": /^Property taxes and insurance$/i,
    "us-gaap:DepreciationAndAmortization": /^Depreciation and amortization$/i,
    "us-gaap:GeneralAndAdministrativeExpense": /^General and administrative$/i,
    "dlr:BusinessCombinationAcquisitionAndIntegrationRelatedCosts":
      /^Transactions and integration$/i,
    "us-gaap:ImpairmentOfLongLivedAssetsToBeDisposedOf":
      /^Impairment of investments in real estate$/i,
    "us-gaap:AssetImpairmentCharges": /^Provision for impairment$/i,
    "us-gaap:OtherCostAndExpenseOperating": /^Other$/i,
    "dlr:OtherExpenseOperating": /^Other$/i,
    "dlr:OtherExpensesOperating": /^Other$/i
  },
  net: {
    "us-gaap:IncomeLossFromEquityMethodInvestments": {
      effect: "gain",
      label: /^Equity in .*unconsolidated (?:entities|joint ventures)$/i
    },
    "us-gaap:DeconsolidationGainOrLossAmount": {
      effect: "gain",
      label: /^Gain on deconsolidation, net$/i
    },
    "us-gaap:GainLossOnDispositionOfAssets": {
      effect: "gain",
      label: /^(?:Gain(?: \(loss\))?|\(Loss\) gain) on disposition of properties, net$/i
    },
    "us-gaap:OtherNonoperatingIncomeExpense": {
      effect: "gain",
      label:
        /^(?:Interest and other income|Other (?:income(?: \(expenses\))?|expense|\(expenses\) income)), net$/i
    },
    "us-gaap:InterestExpense": { effect: "cost", label: /^Interest expense$/i },
    "us-gaap:GainsLossesOnExtinguishmentOfDebt": {
      effect: "gain",
      label:
        /^(?:(?:Gain \(loss\)|Loss) on debt extinguishment and modifications|(?:\(Loss\) gain|Loss) from early extinguishment of debt)$/i
    },
    "us-gaap:IncomeTaxExpenseBenefit": { effect: "cost", label: /^(?:Income )?Tax expense$/i }
  }
} as const;

export function operatingNetCostMeaning(line: StatementLine) {
  const caption = operatingNetRule.costs[line.tag as keyof typeof operatingNetRule.costs];
  return (
    !!caption &&
    caption.test(line.label) &&
    (line.amount >= 0 ||
      /^(?:us-gaap:OtherCostAndExpenseOperating|dlr:OtherExpenses?Operating)$/.test(line.tag ?? ""))
  );
}

export function operatingNetMeaning(line: StatementLine) {
  const rule = operatingNetRule.net[line.tag as keyof typeof operatingNetRule.net];
  return rule?.label.test(line.label) ? rule.effect : undefined;
}

export function operatingNetAllocationMeaning(tag: string, label: string) {
  if (
    tag === "us-gaap:DividendsPreferredStockStock" &&
    /^Preferred stock dividends(?:, including undeclared dividends)?$/i.test(label)
  )
    return "cost";
  if (
    tag === "us-gaap:PreferredStockRedemptionPremium" &&
    /^Issuance costs associated with redeemed preferred stock$/i.test(label)
  )
    return "cost";
  if (
    [
      "dlr:PreferredStockRedemptionPremiumDiscount",
      "us-gaap:PreferredStockRedemptionDiscount"
    ].includes(tag) &&
    /^Gain(?: \(loss\))? on redemption of preferred stock$/i.test(label)
  )
    return "gain";
}

type SourcePeriod = Omit<FinancialPeriod, "metrics" | "displayCurrency"> & {
  displayCurrency: string;
  metrics: Partial<FinancialPeriod["metrics"]>;
  metricSources?: Partial<Record<keyof FinancialPeriod["metrics"], MetricSource>>;
};

export function operatingNetItemsProblem(period: SourcePeriod) {
  const p = period.operatingNetItems;
  if (!p) return;
  const valid = (l: OperatingNetItems["revenue"]) =>
    !!l.id &&
    !!l.label &&
    !!l.tag &&
    Number.isFinite(l.amount) &&
    Number.isInteger(l.decimals) &&
    Number.isInteger(l.rowIndex) &&
    l.rowIndex >= 0 &&
    !Object.keys(l.dimensions ?? {}).length;
  const same = (
    key:
      | "revenue"
      | "totalOperatingCosts"
      | "operatingIncome"
      | "incomeTax"
      | "netIncome"
      | "noncontrollingInterestIncome",
    l: OperatingNetItems["revenue"]
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
  const lines = [
    p.revenue,
    ...p.costs,
    p.expenses,
    ...(p.operatingSubtotal ? [p.operatingSubtotal] : []),
    ...p.operatingGains,
    p.operatingIncome,
    ...p.netItems,
    p.consolidated,
    p.noncontrolling,
    p.parent
  ];
  const tol = Math.max(1e-6, Math.abs(p.revenue.amount) * 1e-9);
  const tax = p.netItems.filter((l) => l.tag === "us-gaap:IncomeTaxExpenseBenefit");
  if (
    p.ruleId !== operatingNetRule.id ||
    !/^\d{10}-\d{2}-\d{6}$/.test(p.accession) ||
    !period.sourceUrl.startsWith(
      `https://www.sec.gov/Archives/edgar/data/${Number(operatingNetRule.cik)}/${p.accession.replaceAll("-", "")}/`
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
    new Set(lines.map((l) => l.id)).size !== lines.length ||
    new Set(lines.map((l) => l.tag)).size !== lines.length ||
    p.revenue.tag !== "us-gaap:Revenues" ||
    !/^Total operating revenues$/i.test(p.revenue.label) ||
    p.revenue.amount <= 0 ||
    p.expenses.tag !== "us-gaap:OperatingExpenses" ||
    !/^Total operating expenses$/i.test(p.expenses.label) ||
    p.expenses.amount < 0 ||
    p.operatingIncome.tag !== "us-gaap:OperatingIncomeLoss" ||
    !/^(?:Total )?Operating income$/i.test(p.operatingIncome.label) ||
    p.consolidated.tag !== "us-gaap:ProfitLoss" ||
    !/^Net income(?: \(loss\))?$/i.test(p.consolidated.label) ||
    p.noncontrolling.tag !== "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest" ||
    p.parent.tag !== "us-gaap:NetIncomeLoss" ||
    !/^Net income(?: \(loss\))? attributable to Digital Realty Trust, Inc\.$/i.test(
      p.parent.label
    ) ||
    p.costs.length < 5 ||
    p.costs.length > 7 ||
    p.costs.some((l) => !operatingNetCostMeaning(l)) ||
    p.netItems.length < 3 ||
    p.netItems.length > 7 ||
    p.netItems.some((l) => operatingNetMeaning(l) !== l.effect) ||
    tax.length !== 1 ||
    !(
      p.netItems.at(-1) === tax[0] ||
      (p.netItems.at(-2) === tax[0] &&
        p.netItems.at(-1)?.tag === "us-gaap:GainsLossesOnExtinguishmentOfDebt")
    ) ||
    !same("incomeTax", tax[0]) ||
    !same("revenue", p.revenue) ||
    !same("totalOperatingCosts", p.expenses) ||
    !same("operatingIncome", p.operatingIncome) ||
    !same("netIncome", p.parent) ||
    !same("noncontrollingInterestIncome", p.noncontrolling) ||
    (p.operatingSubtotal
      ? p.operatingSubtotal.tag !==
          "dlr:OperatingIncomeLossExcludingGainLossOnDispositionOfAssets" ||
        !/^Operating income before gain on disposition of properties, net$/i.test(
          p.operatingSubtotal.label
        ) ||
        p.operatingGains.length !== 1 ||
        Math.abs(p.revenue.amount - p.expenses.amount - p.operatingSubtotal.amount) > tol
      : p.operatingGains.length !== 0) ||
    p.operatingGains.some(
      (l) => l.tag !== "us-gaap:GainLossOnDispositionOfAssets" || operatingNetMeaning(l) !== "gain"
    ) ||
    Math.abs(p.costs.reduce((sum, l) => sum + l.amount, 0) - p.expenses.amount) > tol ||
    Math.abs(
      p.revenue.amount -
        p.expenses.amount +
        p.operatingGains.reduce((sum, l) => sum + l.amount, 0) -
        p.operatingIncome.amount
    ) > tol ||
    Math.abs(
      p.operatingIncome.amount +
        p.netItems.reduce((sum, l) => sum + (l.effect === "gain" ? l.amount : -l.amount), 0) -
        p.consolidated.amount
    ) > tol ||
    Math.abs(p.consolidated.amount - p.noncontrolling.amount - p.parent.amount) > tol ||
    // A separately disclosed Company Facts pretax metric remains an independent
    // reported measure. It is never substituted for a missing primary row.
    (period.metrics.pretaxIncome !== undefined &&
      period.metricSources?.pretaxIncome?.method !== "reported") ||
    period.directNetItems ||
    period.grossOperatingItems ||
    period.operatingItems ||
    period.afterTaxTransactionItems ||
    period.operatingReconciliation ||
    period.afterTaxReconciliation ||
    period.operatingExpensesBasis ||
    period.consolidatedIncomeSubtotal ||
    period.roundedOperatingExpenseComponents ||
    period.operatingCostDetails?.length ||
    period.operatingExpenseDetails?.length ||
    period.grossProfitAdjustments?.length ||
    (
      [
        "costOfRevenue",
        "grossProfit",
        "operatingExpenses",
        "totalExpenses",
        "expensesAndOtherItems",
        "equityMethodIncome",
        "afterTaxSubsidiaryIncome",
        "afterTaxTransactionIncome",
        "discontinuedOperationsIncome"
      ] as const
    ).some((k) => period.metrics[k] !== undefined)
  )
    return "The operating-to-net statement does not reconcile with its reviewed original ledger.";
}
