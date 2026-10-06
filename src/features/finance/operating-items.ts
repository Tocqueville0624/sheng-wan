import type { FinancialPeriod, OperatingItems } from "./types";
import type { MetricSource } from "./v2-types";

/** Reviewed concept meanings only. Values and reporting dates come from filings. */
export const operatingItemRules = [
  {
    id: "apd-operating-items-v1",
    cik: "0000002969",
    revenueTag: "us-gaap:Revenues",
    operatingTag: "us-gaap:OperatingIncomeLoss",
    requiresGains: true,
    items: [
      { tag: "us-gaap:CostOfGoodsAndServicesSold", effect: "cost" },
      { tag: "us-gaap:SellingGeneralAndAdministrativeExpense", effect: "cost" },
      { tag: "us-gaap:ResearchAndDevelopmentExpense", effect: "cost" },
      { tag: "us-gaap:RestructuringCharges", effect: "cost" },
      { tag: "us-gaap:RestructuringAndRelatedCostIncurredCost", effect: "cost" },
      { tag: "us-gaap:GoodwillAndIntangibleAssetImpairment", effect: "cost" },
      { tag: "apd:BusinessSeparationCostsLegalAndAdvisoryFeesBeforeTax", effect: "cost" },
      { tag: "apd:ShareholderActivismCosts", effect: "cost" },
      { tag: "us-gaap:GainLossOnSaleOfBusiness", effect: "gain" },
      { tag: "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges", effect: "gain" },
      { tag: "us-gaap:GainLossOnDispositionOfAssets", effect: "gain" },
      { tag: "apd:NetGainLossOnExchangeOfEquityAffiliateInvestments", effect: "gain" },
      { tag: "apd:OtherIncomeExpenseNet", effect: "gain" }
    ]
  },
  {
    id: "crl-operating-items-v1",
    cik: "0001100682",
    revenueTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    operatingTag: "us-gaap:OperatingIncomeLoss",
    requiresGains: false,
    items: [
      {
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        effect: "cost",
        dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" }
      },
      {
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        effect: "cost",
        dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ProductMember" }
      },
      { tag: "us-gaap:SellingGeneralAndAdministrativeExpense", effect: "cost" },
      { tag: "us-gaap:AmortizationOfIntangibleAssets", effect: "cost" },
      { tag: "us-gaap:ImpairmentOfIntangibleAssetsFinitelived", effect: "cost" },
      { tag: "us-gaap:GoodwillImpairmentLoss", effect: "cost" }
    ]
  }
] as const;

export const operatingScope = (dimensions: Record<string, string> = {}) =>
  JSON.stringify(Object.entries(dimensions).sort(([a], [b]) => a.localeCompare(b)));

export const operatingCostInput = (item: OperatingItems["items"][number], url: string) =>
  `${item.label} (${item.tag}): ${url}`;

export function operatingItemMeaning(
  ruleId: string,
  tag: string,
  label: string,
  dimensions: Record<string, string> = {}
) {
  const rule = operatingItemRules.find((r) => r.id === ruleId);
  const item = rule?.items.find(
    (r) =>
      r.tag === tag &&
      operatingScope("dimensions" in r ? r.dimensions : {}) === operatingScope(dimensions)
  );
  if (!item) return;
  if (
    (tag === "apd:OtherIncomeExpenseNet" && !/^Other income \(expense\), net$/i.test(label)) ||
    (tag === "apd:ShareholderActivismCosts" &&
      !/^Shareholder activism(?:-related)? costs$/i.test(label)) ||
    (tag === "apd:BusinessSeparationCostsLegalAndAdvisoryFeesBeforeTax" &&
      !/^Business separation costs$/i.test(label)) ||
    (tag === "apd:NetGainLossOnExchangeOfEquityAffiliateInvestments" &&
      !/^Gain on exchange (?:of equity affiliate investments|with joint venture partner)$/i.test(
        label
      )) ||
    (tag === "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges" &&
      !/^Facility closure$/i.test(label)) ||
    (tag === "us-gaap:GainLossOnDispositionOfAssets" &&
      !/^Company headquarters relocation income \(expense\)(?: \(See Note \d+\))?$/i.test(label)) ||
    (ruleId === "crl-operating-items-v1" &&
      tag === "us-gaap:CostOfGoodsAndServicesSold" &&
      !new RegExp(
        `^Cost of ${dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ServiceMember" ? "services provided" : "products sold"} \\(excluding amortization of intangible assets\\)$`,
        "i"
      ).test(label))
  )
    return;
  return item.effect;
}

export function operatingItemsProblem(
  period: Omit<FinancialPeriod, "metrics" | "displayCurrency"> & {
    displayCurrency: string;
    metrics: Partial<FinancialPeriod["metrics"]>;
    metricSources?: Partial<Record<keyof FinancialPeriod["metrics"], MetricSource>>;
  }
) {
  const proof = period.operatingItems;
  if (!proof) return;
  const rule = operatingItemRules.find((r) => r.id === proof.ruleId);
  const validLine = (line: OperatingItems["items"][number] | OperatingItems["revenue"]) =>
    !!line.id &&
    !!line.label &&
    !!line.tag &&
    Number.isFinite(line.amount) &&
    Number.isInteger(line.decimals) &&
    Number.isInteger(line.rowIndex) &&
    line.rowIndex >= 0;
  const sameReported = (key: "revenue" | "operatingIncome", line: OperatingItems["revenue"]) => {
    const source = period.metricSources?.[key];
    return (
      period.metrics[key] === line.amount &&
      source?.method === "reported" &&
      source.tag === line.tag &&
      source.decimals === line.decimals &&
      source.sourceUrl === period.sourceUrl &&
      source.accession === period.accession &&
      source.filedAt === period.filedAt
    );
  };
  const costs = proof.items.filter((r) => r.effect === "cost");
  const gains = proof.items.filter((r) => r.effect === "gain");
  const costSum = costs.reduce((s, r) => s + r.amount, 0);
  const gainSum = gains.reduce((s, r) => s + r.amount, 0);
  const costSource = period.metricSources?.totalOperatingCosts;
  const details = costs.filter((r) => r.amount > 0);
  const reportedDetails = period.operatingCostDetails;
  if (
    !rule ||
    !/^\d{10}-\d{2}-\d{6}$/.test(proof.accession) ||
    !period.sourceUrl.startsWith(
      `https://www.sec.gov/Archives/edgar/data/${Number(rule.cik)}/${proof.accession.replaceAll("-", "")}/`
    ) ||
    proof.sourceUrl !== period.sourceUrl ||
    proof.accession !== period.accession ||
    proof.filedAt !== period.filedAt ||
    proof.startDate !== period.startDate ||
    proof.endDate !== period.endDate ||
    proof.currency !== "USD" ||
    period.displayCurrency !== "USD" ||
    period.reportingCurrency !== "USD" ||
    !Number.isInteger(proof.tableIndex) ||
    proof.tableIndex < 0 ||
    !validLine(proof.revenue) ||
    !validLine(proof.operatingIncome) ||
    Object.keys(proof.revenue.dimensions ?? {}).length > 0 ||
    Object.keys(proof.operatingIncome.dimensions ?? {}).length > 0 ||
    proof.revenue.tag !== rule.revenueTag ||
    proof.operatingIncome.tag !== rule.operatingTag ||
    !sameReported("revenue", proof.revenue) ||
    !sameReported("operatingIncome", proof.operatingIncome) ||
    period.metrics.grossProfit !== undefined ||
    period.metrics.operatingExpenses !== undefined ||
    period.operatingReconciliation ||
    !costs.length ||
    (rule.requiresGains && !gains.length) ||
    proof.items.length > rule.items.length ||
    new Set(proof.items.map((r) => r.id)).size !== proof.items.length ||
    new Set(proof.items.map((r) => `${r.tag}|${operatingScope(r.dimensions)}`)).size !==
      proof.items.length ||
    proof.items.some(
      (r, i) =>
        !validLine(r) ||
        operatingItemMeaning(rule.id, r.tag!, r.label, r.dimensions) !== r.effect ||
        (r.effect === "cost" && r.amount < 0) ||
        r.rowIndex <= (proof.items[i - 1]?.rowIndex ?? proof.revenue.rowIndex) ||
        r.rowIndex >= proof.operatingIncome.rowIndex
    ) ||
    period.metrics.totalOperatingCosts !== costSum ||
    costSource?.method !== "calculated" ||
    costSource.label !== "Sum of reported operating cost lines" ||
    costSource.tag !== costs.map((r) => r.tag).join(" + ") ||
    costSource.sourceUrl !== period.sourceUrl ||
    costSource.accession !== period.accession ||
    costSource.filedAt !== period.filedAt ||
    JSON.stringify(costSource.inputs) !==
      JSON.stringify(costs.map((r) => operatingCostInput(r, period.sourceUrl))) ||
    (details.length >= 2
      ? reportedDetails?.length !== details.length ||
        details.some(
          (r, i) =>
            (["id", "label", "amount", "tag", "decimals"] as const).some(
              (key) => r[key] !== reportedDetails?.[i]?.[key]
            ) || operatingScope(r.dimensions) !== operatingScope(reportedDetails?.[i]?.dimensions)
        )
      : !!reportedDetails?.length) ||
    Math.abs(proof.revenue.amount + gainSum - costSum - proof.operatingIncome.amount) >
      Math.max(1e-6, Math.abs(proof.revenue.amount) * 1e-9)
  )
    return "The reported operating costs and gains do not reconcile with their reviewed source ledger.";
}
