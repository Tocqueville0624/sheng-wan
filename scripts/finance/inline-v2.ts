import type { FinancialMetrics } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { buildStatementFlow } from "../../src/features/finance/chart-model";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { flowPeriod } from "./v2-model";

const concepts = {
  revenue: [
    "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    "us-gaap:RevenuesNetOfInterestExpense",
    "us-gaap:Revenues",
    "us-gaap:SalesRevenueNet",
    "ifrs-full:Revenue"
  ],
  operatingIncome: ["us-gaap:OperatingIncomeLoss", "ifrs-full:ProfitLossFromOperatingActivities"],
  pretaxIncome: [
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "ifrs-full:ProfitLossBeforeTax"
  ],
  incomeTax: [
    "us-gaap:IncomeTaxExpenseBenefit",
    "ifrs-full:IncomeTaxExpenseContinuingOperations",
    "ifrs-full:IncomeTaxExpense"
  ],
  netIncome: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss", "ifrs-full:ProfitLoss"],
  totalOperatingCosts: ["us-gaap:CostsAndExpenses"]
} satisfies Partial<Record<keyof FinancialMetrics, string[]>>;

type DirectMetric = keyof typeof concepts;

function precision(fact: XbrlFact): number | undefined {
  if (fact.decimals === Infinity) return 0;
  if (!Number.isInteger(fact.decimals) || fact.decimals < -18 || fact.decimals > 18) return;
  return 0.5 * 10 ** -fact.decimals;
}

/** Highest precision wins only when all copies are consistent with that value. */
function selectFact(facts: XbrlFact[], tag: string): XbrlFact | undefined {
  const candidates = facts
    .filter((fact) => fact.tag === tag && Number.isFinite(fact.value))
    .sort((a, b) => b.decimals - a.decimals);
  const best = candidates[0];
  if (!best) return;
  const bestError = precision(best);
  for (const other of candidates.slice(1)) {
    if (other.value === best.value) continue;
    // Disagreement at equal precision, or unverifiable precision, fails closed.
    if (other.decimals === best.decimals || bestError === undefined) return;
    const otherError = precision(other);
    if (otherError === undefined || Math.abs(other.value - best.value) > bestError + otherError)
      return;
  }
  return best;
}

/** Add a coherent consolidated flow from the same filing; never infer missing pretax. */
export function enrichInlinePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsedInput?: ParsedFiling
): PeriodV2[] {
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Inline filing URL does not match the SEC issuer and accession.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (
    parsed.facts.some(
      (fact) => !/^\d+$/.test(fact.context.cik) || Number(fact.context.cik) !== Number(identity.cik)
    )
  )
    throw new Error("Inline XBRL CIK does not match the catalog.");

  const result: PeriodV2[] = [];
  for (const period of existing) {
    if (
      (period.coverage.segments && !period.businessBreakdownSource) ||
      (period.coverage.sankey && flowPeriod(period)) ||
      period.accession !== filing.accession ||
      period.filedAt !== filing.filedAt ||
      period.sourceUrl !== filing.sourceUrl ||
      period.displayCurrency !== period.reportingCurrency
    )
      continue;
    const facts = parsed.facts.filter(
      (fact) =>
        fact.context.start === period.startDate &&
        fact.context.end === period.endDate &&
        fact.currency === period.displayCurrency &&
        !fact.context.typed &&
        !Object.keys(fact.context.dimensions).length
    );
    const selected: Partial<Record<DirectMetric, XbrlFact>> = {};
    const next: PeriodV2 = {
      ...period,
      metrics: { ...period.metrics },
      metricSources: { ...period.metricSources },
      coverage: { ...period.coverage }
    };
    let addedMetric = false;
    for (const metric of Object.keys(concepts) as DirectMetric[]) {
      const present = period.metrics[metric] !== undefined;
      const allowed =
        metric === "revenue" && !present && identity.sector === "Financials"
          ? ["us-gaap:RevenuesNetOfInterestExpense", "us-gaap:Revenues"]
          : [...concepts[metric]];
      if (metric === "pretaxIncome" && identity.cik === "0000063908")
        allowed.push("mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes");
      const prior = period.metricSources[metric];
      // Existing reported values retain their exact concept, amount, and provenance.
      if (
        present &&
        (!prior ||
          prior.method !== "reported" ||
          prior.accession !== filing.accession ||
          prior.filedAt !== filing.filedAt ||
          prior.sourceUrl !== filing.sourceUrl ||
          !allowed.includes(prior.tag))
      )
        continue;
      const tags = present ? [prior!.tag] : allowed;
      // Do not silently fall through to a lower-priority concept after a conflict.
      const tag = tags.find((candidate) => facts.some((fact) => fact.tag === candidate));
      const chosen = tag ? selectFact(facts, tag) : undefined;
      if (!chosen || (present && period.metrics[metric] !== chosen.value)) continue;
      selected[metric] = chosen;
      if (!present) {
        next.metrics[metric] = chosen.value;
        next.metricSources[metric] = {
          label: metric === "totalOperatingCosts" ? "Total operating costs and expenses" : metric,
          tag: chosen.tag,
          accession: filing.accession,
          filedAt: filing.filedAt,
          sourceUrl: filing.sourceUrl,
          method: "reported"
        };
        addedMetric = true;
      }
      if (Number.isInteger(chosen.decimals) && precision(chosen) !== undefined)
        next.metricSources[metric] = { ...next.metricSources[metric]!, decimals: chosen.decimals };
    }
    if ((Object.keys(concepts) as DirectMetric[]).some((metric) => !selected[metric])) continue;

    const revenue = selected.revenue!,
      costs = selected.totalOperatingCosts!,
      operating = selected.operatingIncome!;
    const difference = operating.value - (revenue.value - costs.value);
    if (difference) {
      const errors = [revenue, costs, operating].map(precision);
      if (
        errors.some((error) => error === undefined) ||
        Math.abs(difference) > errors.reduce<number>((sum, error) => sum + (error ?? 0), 0)
      )
        continue;
      next.operatingReconciliation = {
        label: "Source rounding",
        amount: difference,
        sourceUrl: filing.sourceUrl
      };
    } else delete next.operatingReconciliation;
    const statement = flowPeriod(next);
    next.coverage.sankey = !!statement && buildStatementFlow(statement).ok;
    if (!next.coverage.sankey) continue;
    if (addedMetric || !period.coverage.sankey) result.push(next);
  }
  return result;
}
