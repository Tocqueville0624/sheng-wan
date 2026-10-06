import type { FinancialPeriod, OperatingItems } from "./types";
import type { MetricSource } from "./v2-types";

/** Reviewed concept meanings only. Values and reporting dates come from filings. */
export const operatingItemRules = [
  {
    id: "spgi-operating-subtotals-v1",
    cik: "0000064040",
    revenueTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    operatingTag: "us-gaap:OperatingIncomeLoss",
    costSubtotalTag: "us-gaap:CostsAndExpenses",
    requiresGains: true,
    items: [
      { tag: "us-gaap:CostOfRevenue", effect: "cost" },
      { tag: "us-gaap:SellingGeneralAndAdministrativeExpense", effect: "cost" },
      { tag: "us-gaap:Depreciation", effect: "cost" },
      { tag: "us-gaap:AmortizationOfIntangibleAssets", effect: "cost" },
      { tag: "us-gaap:GainLossOnSaleOfBusiness", effect: "gain" },
      { tag: "us-gaap:IncomeLossFromEquityMethodInvestments", effect: "gain" }
    ]
  },
  {
    id: "carr-operating-subtotals-v1",
    cik: "0001783180",
    revenueTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    operatingTag: "us-gaap:OperatingIncomeLoss",
    costSubtotalTag: "us-gaap:CostsAndExpenses",
    requiresGains: true,
    items: [
      {
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        effect: "cost",
        dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ProductMember" }
      },
      {
        tag: "us-gaap:CostOfGoodsAndServicesSold",
        effect: "cost",
        dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" }
      },
      { tag: "us-gaap:ResearchAndDevelopmentExpense", effect: "cost" },
      { tag: "us-gaap:SellingGeneralAndAdministrativeExpense", effect: "cost" },
      { tag: "us-gaap:IncomeLossFromEquityMethodInvestments", effect: "gain" },
      { tag: "us-gaap:OtherOperatingIncomeExpenseNet", effect: "gain" }
    ]
  },
  {
    id: "pld-operating-subtotals-v1",
    cik: "0001045609",
    revenueTag: "us-gaap:Revenues",
    operatingTag: "us-gaap:OperatingIncomeLoss",
    costSubtotalTag: "pld:OperatingExpensesBeforeGainsOnRealEstateTransactionsNet",
    operatingSubtotalTag: "pld:OperatingIncomeLossBeforeGainsLossOnRealEstateTransactionsNet",
    requiresGains: true,
    items: [
      { tag: "us-gaap:DirectCostsOfLeasedAndRentedPropertyOrEquipment", effect: "cost" },
      { tag: "pld:ServiceManagementCosts", effect: "cost" },
      { tag: "us-gaap:GeneralAndAdministrativeExpense", effect: "cost" },
      { tag: "us-gaap:DepreciationAndAmortization", effect: "cost" },
      { tag: "us-gaap:OtherCostAndExpenseOperating", effect: "cost" },
      { tag: "pld:GainsOnDispositionsOfDevelopmentPropertiesAndLandNet", effect: "gain" },
      { tag: "pld:GainsOnOtherDispositionsOfInvestmentsInRealEstateNet", effect: "gain" }
    ]
  },
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
    (ruleId === "spgi-operating-subtotals-v1" &&
      tag === "us-gaap:GainLossOnSaleOfBusiness" &&
      !/^(?:Gain on dispositions|\(Gain\) loss on dispositions, net)$/i.test(label)) ||
    (ruleId === "spgi-operating-subtotals-v1" &&
      tag === "us-gaap:IncomeLossFromEquityMethodInvestments" &&
      !/^Equity in income on unconsolidated subsidiaries$/i.test(label)) ||
    (ruleId === "carr-operating-subtotals-v1" &&
      tag === "us-gaap:CostOfGoodsAndServicesSold" &&
      !new RegExp(
        `^Cost of ${dimensions["srt:ProductOrServiceAxis"] === "us-gaap:ProductMember" ? "products" : "services"} sold$`,
        "i"
      ).test(label)) ||
    (ruleId === "carr-operating-subtotals-v1" &&
      tag === "us-gaap:IncomeLossFromEquityMethodInvestments" &&
      !/^Equity method investment net earnings$/i.test(label)) ||
    (ruleId === "carr-operating-subtotals-v1" &&
      tag === "us-gaap:OtherOperatingIncomeExpenseNet" &&
      !/^Other income \(expense\), net$/i.test(label)) ||
    (tag === "pld:ServiceManagementCosts" && !/^Strategic capital$/i.test(label)) ||
    (tag === "pld:GainsOnDispositionsOfDevelopmentPropertiesAndLandNet" &&
      !/^Gains on dispositions of development properties and land, net$/i.test(label)) ||
    (tag === "pld:GainsOnOtherDispositionsOfInvestmentsInRealEstateNet" &&
      !/^Gains on other dispositions of investments in real estate, net$/i.test(label))
  )
    return;
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
  const checkpoints = [proof.costSubtotal, proof.operatingSubtotal].filter((l) => l !== undefined);
  const completeRows = [...proof.items, ...checkpoints].sort((a, b) => a.rowIndex - b.rowIndex);
  const tolerance = Math.max(1e-6, Math.abs(proof.revenue.amount) * 1e-9);
  const excluded = proof.excludedSegmentExpenses;
  const excludedProblem =
    !!excluded &&
    (rule?.id !== "pld-operating-subtotals-v1" ||
      !Number.isInteger(excluded.tableIndex) ||
      excluded.tableIndex < 0 ||
      excluded.tableIndex === proof.tableIndex ||
      [excluded.revenue, excluded.totalExpenses, excluded.segmentIncome].some(
        (l) => !validLine(l)
      ) ||
      Object.keys(excluded.revenue.dimensions ?? {}).length > 0 ||
      Object.keys(excluded.totalExpenses.dimensions ?? {}).length > 0 ||
      operatingScope(excluded.segmentIncome.dimensions) !==
        operatingScope({ "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }) ||
      excluded.revenue.tag !== "us-gaap:Revenues" ||
      !/^Total revenues$/i.test(excluded.revenue.label) ||
      excluded.totalExpenses.tag !== "us-gaap:OperatingExpenses" ||
      !/^Total expenses$/i.test(excluded.totalExpenses.label) ||
      excluded.segmentIncome.tag !== "us-gaap:OperatingIncomeLoss" ||
      !/^Total segment net operating income$/i.test(excluded.segmentIncome.label) ||
      excluded.revenue.amount !== proof.revenue.amount ||
      excluded.totalExpenses.amount >= 0 ||
      excluded.revenue.rowIndex >= excluded.totalExpenses.rowIndex ||
      excluded.totalExpenses.rowIndex >= excluded.segmentIncome.rowIndex ||
      Math.abs(
        excluded.revenue.amount + excluded.totalExpenses.amount - excluded.segmentIncome.amount
      ) > tolerance ||
      Math.abs(excluded.segmentIncome.amount - proof.operatingIncome.amount) <= tolerance ||
      excluded.originalMetricSource.method !== "reported" ||
      excluded.originalMetricSource.tag !== excluded.totalExpenses.tag ||
      excluded.originalMetricSource.sourceUrl !== period.sourceUrl ||
      excluded.originalMetricSource.accession !== period.accession ||
      excluded.originalMetricSource.filedAt !== period.filedAt ||
      (excluded.originalMetricSource.decimals !== undefined &&
        excluded.originalMetricSource.decimals !== excluded.totalExpenses.decimals) ||
      !!excluded.originalMetricSource.inputs?.length);
  const subtotalProblem = !rule
    ? true
    : "costSubtotalTag" in rule
      ? !proof.costSubtotal ||
        !validLine(proof.costSubtotal) ||
        Object.keys(proof.costSubtotal.dimensions ?? {}).length > 0 ||
        proof.costSubtotal.tag !== rule.costSubtotalTag ||
        !/^(?:Total\s+)?(?:Costs and expenses|Expenses)$/i.test(proof.costSubtotal.label) ||
        Math.abs(proof.costSubtotal.amount - costSum) > tolerance ||
        costs.some((l) => l.rowIndex >= proof.costSubtotal!.rowIndex) ||
        gains.some((l) => l.rowIndex <= proof.costSubtotal!.rowIndex) ||
        completeRows.length !== proof.operatingIncome.rowIndex - proof.revenue.rowIndex - 1 ||
        completeRows.some((l, i) => l.rowIndex !== proof.revenue.rowIndex + i + 1) ||
        new Set(completeRows.map((l) => l.id)).size !== completeRows.length ||
        ("operatingSubtotalTag" in rule
          ? !proof.operatingSubtotal ||
            !validLine(proof.operatingSubtotal) ||
            Object.keys(proof.operatingSubtotal.dimensions ?? {}).length > 0 ||
            proof.operatingSubtotal.tag !== rule.operatingSubtotalTag ||
            !/^Operating income before gains on real estate transactions, net$/i.test(
              proof.operatingSubtotal.label
            ) ||
            proof.operatingSubtotal.rowIndex !== proof.costSubtotal.rowIndex + 1 ||
            gains.some((l) => l.rowIndex <= proof.operatingSubtotal!.rowIndex) ||
            Math.abs(proof.revenue.amount - costSum - proof.operatingSubtotal.amount) > tolerance
          : !!proof.operatingSubtotal)
      : !!proof.costSubtotal || !!proof.operatingSubtotal;
  const costSourceProblem = proof.costSubtotal
    ? costSource?.method !== "reported" ||
      costSource.label !== proof.costSubtotal.label ||
      costSource.tag !== proof.costSubtotal.tag ||
      costSource.decimals !== proof.costSubtotal.decimals ||
      !!costSource.inputs?.length
    : costSource?.method !== "calculated" ||
      costSource.label !== "Sum of reported operating cost lines" ||
      costSource.tag !== costs.map((l) => l.tag).join(" + ") ||
      JSON.stringify(costSource.inputs) !==
        JSON.stringify(costs.map((l) => operatingCostInput(l, period.sourceUrl)));
  if (
    !rule ||
    subtotalProblem ||
    excludedProblem ||
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
    costSourceProblem ||
    costSource?.sourceUrl !== period.sourceUrl ||
    costSource.accession !== period.accession ||
    costSource.filedAt !== period.filedAt ||
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
