import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { enrichStatementPeriods } from "./statement-v2";
import { bacRevenueProblem } from "../../src/features/finance/bac-revenue";
import { flowPeriod } from "./v2-model";

/** A validated complete BAC primary revenue section permits the original custom
 * revenue anchor. All previously retained fields and sources still take priority. */
export function enrichBacIncomePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  if (identity.cik !== "0000070858") return [];
  const candidates = periods.filter(
    (p) => !flowPeriod(p) && p.businessBreakdownSource?.bacRevenue && !bacRevenueProblem(p)
  );
  return enrichStatementPeriods(html, identity, filing, candidates, parsed).flatMap((reading) => {
    const prior = candidates.find((p) => p.id === reading.id)!;
    const next: PeriodV2 = {
      ...reading,
      ...prior,
      metrics: { ...reading.metrics, ...prior.metrics },
      metricSources: { ...reading.metricSources, ...prior.metricSources },
      coverage: { ...reading.coverage, ...prior.coverage, sankey: true }
    };
    return flowPeriod(next) ? [next] : [];
  });
}
