import type { AfterTaxTransactionItems, FinancialPeriod } from "./types";
import type { MetricSource } from "./v2-types";

/** Finite reviewed source meaning; no amounts or reporting dates are supplied here. */
export const afterTaxTransactionRule = {
  id: "mdlz-after-tax-transaction-v1",
  cik: "0001103982",
  tags: {
    pretax:
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    tax: "us-gaap:IncomeTaxExpenseBenefit",
    transaction: "mdlz:EquityMethodInvestmentRealizedGainLossOnTransaction",
    equity: "us-gaap:IncomeLossFromEquityMethodInvestments",
    consolidated: "us-gaap:ProfitLoss",
    noncontrolling: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
    parent: "us-gaap:NetIncomeLoss"
  }
} as const;

/** The lowercase 'on' spelling occurs in the reviewed 2016–2018 source facts.
 * These are issuer-scoped meanings, never global taxonomy aliases. */
export const afterTaxTransactionTags = new Set<string>([
  afterTaxTransactionRule.tags.transaction,
  "mdlz:EquityMethodInvestmentRealizedGainLossonTransaction"
]);
const transactionCaptions = new Set([
  "Gain/(loss) on equity method investment transactions",
  "Loss on equity method investment transactions",
  "Gain on equity method investment transactions",
  "Net (loss)/gain on equity method investment transactions",
  "(Loss)/gain on equity method investment transactions",
  "(Loss)/gain on equity method investment transactions including impairments"
]);

type Candidate = Pick<
  FinancialPeriod,
  | "sourceUrl"
  | "accession"
  | "filedAt"
  | "startDate"
  | "endDate"
  | "reportingCurrency"
  | "afterTaxTransactionItems"
  | "afterTaxReconciliation"
  | "consolidatedIncomeSubtotal"
> & {
  displayCurrency: string;
  metrics: Partial<FinancialPeriod["metrics"]>;
  metricSources?: Partial<Record<keyof FinancialPeriod["metrics"], MetricSource>>;
};

export function afterTaxTransactionItemsProblem(period: Candidate): string | undefined {
  const p = period.afterTaxTransactionItems;
  if (!p)
    return period.metrics.afterTaxTransactionIncome !== undefined
      ? "The after-tax transaction amount has no reviewed source chain."
      : undefined;
  const fail = "The after-tax transaction does not reconcile with its reviewed source chain.";
  let url: URL;
  try {
    url = new URL(p.sourceUrl);
  } catch {
    return fail;
  }
  if (
    p.ruleId !== afterTaxTransactionRule.id ||
    p.currency !== "USD" ||
    period.reportingCurrency !== "USD" ||
    period.displayCurrency !== "USD" ||
    p.sourceUrl !== period.sourceUrl ||
    p.accession !== period.accession ||
    p.filedAt !== period.filedAt ||
    p.startDate !== period.startDate ||
    p.endDate !== period.endDate ||
    !/^\d{10}-\d{2}-\d{6}$/.test(p.accession) ||
    !Number.isInteger(p.tableIndex) ||
    p.tableIndex < 0 ||
    p.tableIndex >= 2000 ||
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(afterTaxTransactionRule.cik)}/${p.accession.replaceAll("-", "")}/`
    ) ||
    period.afterTaxReconciliation ||
    period.consolidatedIncomeSubtotal
  )
    return fail;
  const keys = Object.keys(
    afterTaxTransactionRule.tags
  ) as (keyof typeof afterTaxTransactionRule.tags)[];
  for (const [i, key] of keys.entries()) {
    const l = p[key];
    if (
      !l ||
      (key === "transaction"
        ? !afterTaxTransactionTags.has(l.tag ?? "")
        : l.tag !== afterTaxTransactionRule.tags[key]) ||
      !l.label ||
      l.label.length > 180 ||
      !l.id ||
      !Number.isFinite(l.amount) ||
      !Number.isInteger(l.decimals) ||
      !Number.isInteger(l.rowIndex) ||
      l.rowIndex < 0 ||
      l.rowIndex >= 500 ||
      Object.keys(l.dimensions ?? {}).length ||
      (i > 0 && l.rowIndex !== p[keys[i - 1]].rowIndex + 1)
    )
      return fail;
  }
  if (
    !transactionCaptions.has(p.transaction.label) ||
    p.pretax.amount - p.tax.amount + p.transaction.amount + p.equity.amount !==
      p.consolidated.amount ||
    p.consolidated.amount - p.noncontrolling.amount !== p.parent.amount ||
    period.metrics.afterTaxSubsidiaryIncome !== undefined ||
    period.metrics.discontinuedOperationsIncome !== undefined
  )
    return fail;
  for (const [metric, key] of [
    ["pretaxIncome", "pretax"],
    ["incomeTax", "tax"],
    ["afterTaxTransactionIncome", "transaction"],
    ["equityMethodIncome", "equity"],
    ["noncontrollingInterestIncome", "noncontrolling"],
    ["netIncome", "parent"]
  ] as const) {
    const l = p[key];
    if (period.metrics[metric] !== l.amount) return fail;
    if (!period.metricSources) continue;
    const source = period.metricSources[metric];
    if (
      !source ||
      source.method !== "reported" ||
      source.tag !== l.tag ||
      source.sourceUrl !== p.sourceUrl ||
      source.accession !== p.accession ||
      source.filedAt !== p.filedAt ||
      source.decimals !== l.decimals
    )
      return fail;
  }
}

export const afterTaxTransactionLabel = (p: AfterTaxTransactionItems) =>
  `Equity-method transaction ${p.transaction.amount < 0 ? "loss" : "gain"} (${p.transaction.label.endsWith("including impairments") ? "including impairments; " : ""}after tax)`;
