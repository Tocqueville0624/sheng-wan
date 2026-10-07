import type { FinancialMetrics } from "./types";
import type { MetricSource, PeriodV2 } from "./v2-types";

/** The complete saved record remains evidence; it is never spliced into the
 * original statement's metric or business provenance. No nested upgrades. */
export type OriginalStatementCorroboration = {
  ruleId: "original-complete-statement-known-reported-facts-v1";
  cik: string;
  basis: "saved-reported-facts";
  prior: Omit<PeriodV2, "originalStatementCorroboration">;
};

const scopeKeys = [
  "id",
  "kind",
  "fiscalYear",
  "fiscalQuarter",
  "startDate",
  "endDate",
  "reportingCurrency",
  "displayCurrency"
] as const;
const metricKeys = new Set<keyof FinancialMetrics>([
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingExpenses",
  "totalOperatingCosts",
  "totalExpenses",
  "operatingIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
  "researchAndDevelopment",
  "sellingGeneralAndAdministrative",
  "equityMethodIncome",
  "afterTaxSubsidiaryIncome",
  "afterTaxTransactionIncome",
  "noncontrollingInterestIncome",
  "discontinuedOperationsIncome",
  "expensesAndOtherItems"
]);
// Known detail cannot disappear when an earlier statement becomes canonical.
// Rich source-specific ledgers need a separately reviewed semantic join; a
// matching headline income number alone does not authorize replacing them.
const retainedFields = [
  "grossProfitAdjustments",
  "operatingReconciliation",
  "afterTaxReconciliation",
  "shareholderBridge",
  "operatingItems",
  "grossOperatingItems",
  "alignInlineIncome",
  "dardenInlineIncome",
  "directNetItems",
  "operatingNetItems",
  "afterTaxTransactionItems",
  "consolidatedIncomeSubtotal",
  "roundedOperatingExpenseComponents",
  "operatingExpenseDetails",
  "operatingCostDetails",
  "operatingExpensesBasis"
] as const;
const businessScopeKeys = [
  "method",
  "ruleId",
  "revenueTag",
  "axis",
  "qualifiers",
  "totalDimensions",
  "totalLabel",
  "layout"
] as const;
const originKeys = new Set([
  "sourceUrl",
  "accession",
  "filedAt",
  "tableIndex",
  "columnIndex",
  "rowIndex",
  "headerRowIndex",
  "contextId"
]);
const stable = (value: unknown, omitOrigin = false): string => {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v, omitOrigin)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([key, v]) => v !== undefined && !(omitOrigin && originKeys.has(key)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${stable(v, omitOrigin)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const issuerSource = (cik: string, sourceUrl: string, accession: string | undefined) => {
  if (!/^\d{10}$/.test(cik) || !accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return false;
  try {
    const u = new URL(sourceUrl);
    return (
      u.origin === "https://www.sec.gov" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.startsWith(
        `/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/`
      ) &&
      !!u.pathname.split("/").at(-1)
    );
  } catch {
    return false;
  }
};
const boundReportedSource = (p: PeriodV2, source: MetricSource | undefined) =>
  !!source &&
  source.method === "reported" &&
  typeof source.tag === "string" &&
  /^[\w.-]+:[\w.-]+$/.test(source.tag) &&
  typeof source.label === "string" &&
  !!source.label.trim() &&
  source.sourceUrl === p.sourceUrl &&
  source.accession === p.accession &&
  source.filedAt === p.filedAt &&
  (source.inputs === undefined || (Array.isArray(source.inputs) && source.inputs.length === 0)) &&
  (source.decimals === undefined || Number.isInteger(source.decimals));

/** Pure source/fact contract. The v2 validator separately replays BOTH complete
 * original chart capabilities and validates the unchanged prior record. */
export function originalStatementCorroborationProblem(
  cik: string,
  p: PeriodV2,
  proof: OriginalStatementCorroboration
): string | undefined {
  if (
    !proof ||
    proof.ruleId !== "original-complete-statement-known-reported-facts-v1" ||
    proof.cik !== cik ||
    proof.basis !== "saved-reported-facts"
  )
    return "Unrecognized original-statement corroboration rule or issuer.";
  const old = proof.prior;
  if (
    !old ||
    !old.metrics ||
    !old.metricSources ||
    !old.coverage ||
    ("originalStatementCorroboration" in old && old.originalStatementCorroboration !== undefined)
  )
    return "Missing or recursively substituted saved statement.";
  if (
    old.derived !== false ||
    old.fx ||
    ![old.coverage.basics, old.coverage.sankey, old.coverage.segments].every(
      (v) => typeof v === "boolean"
    ) ||
    (old.coverage.segments && old.coverage.sankey)
  )
    return "Prior statement is not an incomplete unconverted reported statement.";
  if (
    scopeKeys.some((key) => old[key] !== p[key]) ||
    typeof old.label !== "string" ||
    !old.label.trim() ||
    !Number.isInteger(old.fiscalYear) ||
    old.reportingCurrency !== "USD" ||
    old.displayCurrency !== "USD" ||
    (old.kind === "quarterly" && ![1, 2, 3, 4].includes(old.fiscalQuarter!))
  )
    return "Saved and original statements have different fiscal, date or currency scope.";
  if (
    ![old.startDate, old.endDate, old.filedAt, p.filedAt].every(date) ||
    old.startDate >= old.endDate ||
    old.endDate > p.filedAt ||
    p.filedAt >= old.filedAt ||
    old.filedAt > new Date().toISOString().slice(0, 10)
  )
    return "Original statement is not a valid earlier period source.";
  if (
    !issuerSource(cik, old.sourceUrl, old.accession) ||
    !issuerSource(cik, p.sourceUrl, p.accession) ||
    old.accession === p.accession
  )
    return "Saved and original statement sources are not independently bound to the SEC issuer.";
  const keys = Object.keys(old.metrics) as (keyof FinancialMetrics)[];
  if (
    !keys.length ||
    Object.keys(old.metricSources).length !== keys.length ||
    keys.some(
      (key) =>
        !metricKeys.has(key) ||
        !Number.isFinite(old.metrics[key]) ||
        old.metrics[key] !== p.metrics[key] ||
        !boundReportedSource(old as PeriodV2, old.metricSources[key]) ||
        !boundReportedSource(p, p.metricSources[key]) ||
        old.metricSources[key]!.tag !== p.metricSources[key]!.tag
    )
  )
    return "A known value, reported concept, method or source binding changed.";
  if (retainedFields.some((key) => old[key] !== undefined && stable(old[key]) !== stable(p[key])))
    return "Existing accounting detail requires a separately reviewed source join.";
  if (old.segments !== undefined || old.businessBreakdownSource !== undefined) {
    if (
      !old.coverage.segments ||
      !old.segments?.length ||
      old.segments.length !== p.segments?.length ||
      stable(old.segments, true) !== stable(p.segments, true) ||
      old.segmentBasis !== p.segmentBasis ||
      stable(old.revenueAdjustments, true) !== stable(p.revenueAdjustments, true) ||
      businessScopeKeys.some(
        (key) =>
          stable(old.businessBreakdownSource?.[key]) !== stable(p.businessBreakdownSource?.[key])
      )
    )
      return "Existing business amounts, categories or accounting scope changed.";
  } else if (old.segmentSourceUrl || old.segmentBasis || old.revenueAdjustments?.length) {
    return "Unvalidated prior business metadata cannot be silently replaced.";
  }
  if (!p.coverage.segments || !p.coverage.sankey)
    return "Original statement lacks both complete business and financial capabilities.";
}

export function corroborateOriginalStatement(cik: string, old: PeriodV2, next: PeriodV2) {
  if (old.originalStatementCorroboration) return;
  const proof: OriginalStatementCorroboration = {
    ruleId: "original-complete-statement-known-reported-facts-v1",
    cik,
    basis: "saved-reported-facts",
    prior: structuredClone(old)
  };
  return originalStatementCorroborationProblem(cik, next, proof) ? undefined : proof;
}
