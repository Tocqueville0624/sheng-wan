import { originalJpmCandidate } from "./v2-model";
import { enrichJpmBusinessPeriods } from "./jpm-business-v2";
import { enrichBacIncomePeriods } from "./bac-income-v2";
import { enrichBacBusinessPeriods } from "./bac-business-v2";
import { enrichAmdBusinessPeriods } from "./amd-business-v2";
import { enrichAmdIncomePeriods } from "./amd-income-v2";
import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import { enrichBusinessPeriods } from "./business-v2";
import { parseInlineXbrl } from "./ixbrl";
import { enrichInlinePeriods } from "./inline-v2";
import type { SecFiling } from "./sec-shared";
import { enrichStatementPeriods } from "./statement-v2";
import { enrichReviewedBusinessPeriods } from "./reviewed-business";
import { enrichMatrixBusinessPeriods } from "./business-matrix";
import { currentFilingCandidates } from "./current-filing";
import { enrichShareholderPeriods } from "./shareholder-v2";
import { enrichOperatingPeriods } from "./operating-v2";
import { enrichDirectNetPeriods } from "./direct-net-v2";
import { enrichGrossOperatingPeriods } from "./gross-operating-v2";
import { enrichOperatingNetPeriods } from "./operating-net-v2";
import { enrichProductPortfolioPeriods } from "./product-portfolio-v2";
import { enrichServiceRevenuePeriods } from "./service-revenue-v2";
import { enrichAlbemarleBusinessPeriods } from "./albemarle-business-v2";
import { enrichAmetekBusinessPeriods } from "./ametek-business-v2";
import { enrichChurchDwightBusinessPeriods } from "./church-dwight-business-v2";
import { enrichOriginalHierarchyBusinessPeriods } from "./original-hierarchy-business-v2";
import { enrichCencoraBusinessPeriods } from "./cencora-business-v2";
import { enrichDardenBusinessPeriods } from "./darden-business-v2";
import { enrichDardenInlineIncomePeriods } from "./darden-inline-income-v2";
import { enrichAlbemarleInlineIncomePeriods } from "./albemarle-inline-income-v2";
import { enrichAlignInlineIncomePeriods } from "./align-inline-income-v2";

/** Generic (unreviewed-issuer) imports share these steps between the Worker and CLI audits. */
export const GENERIC_FILING_LIMIT = 30;

/** Saved periods plus newer Company Facts candidates from the running task, keyed by dates. */
export function genericCandidates(base: CompanyV2, fresh: PeriodV2[] = []) {
  const periods = new Map<string, PeriodV2>(
    [...base.annual, ...base.quarterly].map((period) => {
      const p = originalJpmCandidate(base.cik, period);
      return [`${p.kind}:${p.startDate}:${p.endDate}`, p] as const;
    })
  );
  for (const p of fresh) {
    const key = `${p.kind}:${p.startDate}:${p.endDate}`;
    const old = periods.get(key);
    if (!old || p.filedAt > old.filedAt) periods.set(key, p);
  }
  return [...periods.values()];
}

/** Missing capabilities plus the newest annual/quarterly sources, even when
 * Company Facts has not indexed their current periods or amendments yet.
 */
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
  const eligible = filings.filter((f) => /^(10-K|10-Q)(\/A)?$/.test(f.form));
  for (const form of ["10-K", "10-Q"]) {
    const latest = eligible
      .filter((f) => f.form.startsWith(form))
      .sort(
        (a, b) => b.reportDate.localeCompare(a.reportDate) || b.filedAt.localeCompare(a.filedAt)
      )[0];
    if (
      latest &&
      !candidates.some(
        (p) =>
          p.endDate === latest.reportDate &&
          p.accession === latest.accession &&
          p.filedAt === latest.filedAt &&
          p.coverage.sankey &&
          p.coverage.segments
      )
    )
      missing.add(latest.accession);
  }
  const selected = filings
    .filter((f) => /^(10-K|10-Q)(\/A)?$/.test(f.form) && missing.has(f.accession))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.filedAt.localeCompare(a.filedAt))
    .slice(0, limit);
  // A later comparative disclosure can contain only a few facts for an older
  // period. Its accession must not hide that period's own acquired report.
  // Preserve every existing selection; use only the remaining source budget.
  const selectedAccessions = new Set(selected.map((f) => f.accession));
  const originals = eligible
    .filter(
      (f) =>
        !selectedAccessions.has(f.accession) &&
        candidates.some(
          (p) =>
            (!p.coverage.sankey || !p.coverage.segments) &&
            p.displayCurrency === "USD" &&
            p.endDate === f.reportDate &&
            p.filedAt > f.filedAt &&
            (p.kind === "annual" ? /^10-K/.test(f.form) : /^10-Q/.test(f.form))
        )
    )
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.filedAt.localeCompare(a.filedAt));
  return [...selected, ...originals].slice(0, limit);
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
  base: CompanyV2 | undefined,
  fresh?: PeriodV2[],
  industrySic?: string
): PeriodV2[] {
  const candidates = base ? genericCandidates(base, fresh) : [...(fresh ?? [])];
  const parsed = parseInlineXbrl(html);
  candidates.push(...currentFilingCandidates(identity, filing, parsed, candidates, industrySic));
  const updated = new Map(candidates.map((p) => [p.id, p]));
  const changes = new Map<string, PeriodV2>();
  const apply = (periods: PeriodV2[]) =>
    periods.forEach((p) => {
      updated.set(p.id, p);
      changes.set(p.id, p);
    });
  apply(enrichInlinePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichStatementPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichOperatingPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichGrossOperatingPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichDirectNetPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichOperatingNetPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichShareholderPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAlbemarleBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAmetekBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichChurchDwightBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(
    enrichOriginalHierarchyBusinessPeriods(html, identity, filing, [...updated.values()], parsed)
  );
  apply(enrichCencoraBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichDardenInlineIncomePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichDardenBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAmdBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAmdIncomePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichJpmBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichBacBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichBacIncomePeriods(html, identity, filing, [...updated.values()], parsed));
  // This reviewed issuer stays fail-closed when its captions or corporate scope
  // change. A generic subset or another revenue classification is not a fallback.
  if (
    ![
      "0000915913",
      "0001037868",
      "0000313927",
      "0001140859",
      "0000940944",
      "0000002488",
      "0000070858",
      "0000019617"
    ].includes(identity.cik) &&
    !(["0000008818", "0000010456"].includes(identity.cik) && parsed.fiscalYear >= 2023)
  ) {
    apply(enrichBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
    apply(enrichReviewedBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
    apply(enrichMatrixBusinessPeriods(html, identity, filing, [...updated.values()], parsed));
  }
  apply(enrichProductPortfolioPeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichServiceRevenuePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAlbemarleInlineIncomePeriods(html, identity, filing, [...updated.values()], parsed));
  apply(enrichAlignInlineIncomePeriods(html, identity, filing, [...updated.values()], parsed));
  return [...changes.values()];
}
