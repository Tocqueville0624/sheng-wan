import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import { enrichBusinessPeriods } from "./business-v2";
import { parseInlineXbrl } from "./ixbrl";
import { enrichInlinePeriods } from "./inline-v2";
import type { SecFiling } from "./sec-shared";
import { enrichStatementPeriods } from "./statement-v2";
import { enrichReviewedBusinessPeriods } from "./reviewed-business";

/** Generic (unreviewed-issuer) imports share these steps between the Worker and CLI audits. */
export const GENERIC_FILING_LIMIT = 30;

/** Saved periods plus newer Company Facts candidates from the running task, keyed by dates. */
export function genericCandidates(base: CompanyV2, fresh: PeriodV2[] = []) {
  const periods = new Map(
    [...base.annual, ...base.quarterly].map((p) => [`${p.kind}:${p.startDate}:${p.endDate}`, p])
  );
  for (const p of fresh) {
    const key = `${p.kind}:${p.startDate}:${p.endDate}`;
    const old = periods.get(key);
    if (!old || p.filedAt > old.filedAt) periods.set(key, p);
  }
  return [...periods.values()];
}

/** Newest filings whose periods still lack a profit flow or business breakdown. */
export function genericFilingTodo(
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] | undefined,
  filings: SecFiling[],
  limit = GENERIC_FILING_LIMIT
) {
  const candidates = base ? genericCandidates(base, fresh) : [];
  const missing = new Set(
    candidates
      .filter((p) => (!p.coverage.sankey || !p.coverage.segments) && p.displayCurrency === "USD")
      .map((p) => p.accession)
  );
  return filings
    .filter((f) => /^(10-K|10-Q)(\/A)?$/.test(f.form) && missing.has(f.accession))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, limit);
}

/**
 * Read one archived inline filing once: consolidated standard facts, then the
 * filing's own income-statement rows, then business revenue rows. Returns only
 * periods whose validated capability changed; no values are estimated.
 */
export function readGenericFiling(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2,
  fresh?: PeriodV2[]
): PeriodV2[] {
  const candidates = genericCandidates(base, fresh);
  const parsed = parseInlineXbrl(html);
  const updated = new Map(candidates.map((p) => [p.id, p]));
  const changes = new Map<string, PeriodV2>();
  const apply = (periods: PeriodV2[]) =>
    periods.forEach((p) => {
      updated.set(p.id, p);
      changes.set(p.id, p);
    });
  apply(enrichInlinePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichStatementPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichReviewedBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  return [...changes.values()];
}
