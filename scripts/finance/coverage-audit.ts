import { buildStatementFlow } from "../../src/features/finance/chart-model";
import type { FlowStatementPeriod } from "../../src/features/finance/types";
import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import { enrichBusinessPeriods } from "./business-v2";
import { extractFactsV2, parseFactsDocument } from "./facts-v2";
import { genericCandidates, genericFilingTodo, readGenericFiling } from "./generic-import";
import { enrichInlinePeriods } from "./inline-v2";
import { parseInlineXbrl } from "./ixbrl";
import { issuerSources, type SecSource } from "./issuer-sources";
import { flowPeriod, mergeV2, normalizeBasicCompany } from "./v2-model";
import { companyFromFilingPeriods, missingStandardHistory } from "./current-filing";
import {
  originalStandaloneBusinessRequired,
  readOriginalStandaloneBusinessFiling
} from "./standalone-business-v2";
import { originalStandaloneIndexUrl, originalStandaloneXmlUrls } from "./standalone-source-index";

/** Returns an SEC response body; the CLI caches, tests may supply fixtures. */
export type AuditSource = SecSource;

export type PeriodSummary = {
  id: string;
  endDate: string;
  sankey: boolean;
  segments: boolean;
  missing: string[];
  reason?: string;
};
export type CompanyReport = {
  ticker: string;
  sector: string;
  status: "ok" | "error";
  error?: string;
  annual?: PeriodSummary[];
  quarterly?: PeriodSummary[];
  sankey?: string;
  segments?: string;
  latestAnnualSankey?: boolean;
  latestQuarterSankey?: boolean;
  previousLatestAnnualSankey?: boolean;
  previousSankey?: string;
  filingsRead?: number;
  warnings?: string[];
};

const required = ["revenue", "operatingIncome", "pretaxIncome", "incomeTax", "netIncome"] as const;
function summarize(period: PeriodV2): PeriodSummary {
  const missing = required.filter((key) => period.metrics[key] === undefined);
  if (period.metrics.grossProfit === undefined && period.metrics.totalOperatingCosts === undefined)
    missing.push("grossProfit|totalOperatingCosts" as never);
  let reason: string | undefined;
  if (!period.coverage.sankey) {
    if (missing.length) reason = `missing ${missing.join(", ")}`;
    else {
      const flow = buildStatementFlow(period as FlowStatementPeriod);
      reason = flow.ok ? (flowPeriod(period) ? "not marked" : "flow period rejected") : flow.reason;
    }
  }
  return {
    id: period.id,
    endDate: period.endDate,
    sankey: period.coverage.sankey,
    segments: period.coverage.segments,
    missing,
    reason
  };
}

/**
 * Replays the Worker's generic import for one issuer without storage side effects.
 * The previous engine's result (standard inline concepts and business rows, no
 * statement-row reading) is computed from the same sources for comparison.
 */
export async function auditCompanyDataset(
  identity: CatalogCompany,
  source: AuditSource,
  maxFilings = 30,
  reviewedSeed?: CompanyV2
): Promise<{ report: CompanyReport; company: CompanyV2 }> {
  const { submissions, filings, factsSource } = await issuerSources(identity, source);
  const industrySic = /^\d{4}$/.test(submissions.sic ?? "") ? submissions.sic : undefined;
  const facts = parseFactsDocument(factsSource);
  let basic: CompanyV2 | undefined;
  try {
    basic = extractFactsV2(facts, identity, filings, undefined, industrySic);
  } catch (error) {
    if (!missingStandardHistory(error)) throw error;
  }
  let company: CompanyV2 | undefined = basic
    ? normalizeBasicCompany(mergeV2(reviewedSeed, { ...basic, version: "audit" }))
    : reviewedSeed;
  let previous = company;
  const basicPeriods = [...(basic?.annual ?? []), ...(basic?.quarterly ?? [])];
  const todo = genericFilingTodo(company, basicPeriods, filings, maxFilings);
  const warnings = [...(company?.warnings ?? [])];
  const publish = (base: CompanyV2 | undefined, periods: PeriodV2[]) =>
    periods.length
      ? mergeV2(base, {
          ...(base ?? companyFromFilingPeriods(identity, periods)),
          annual: periods.filter((p) => p.kind === "annual"),
          quarterly: periods.filter((p) => p.kind === "quarterly")
        })
      : base;
  for (const filing of todo) {
    try {
      const html = await source(filing.sourceUrl);
      if (
        !/<(?:[\w.-]+:)?nonFraction\b/i.test(html) &&
        originalStandaloneBusinessRequired(identity, filing, company, basicPeriods)
      ) {
        try {
          const index = await source(originalStandaloneIndexUrl(identity.cik, filing));
          const urls = originalStandaloneXmlUrls(index, identity.cik, filing);
          if (urls.length !== 1)
            throw Error("Original standalone instance requires attachment review.");
          const periods = await readOriginalStandaloneBusinessFiling(
            html,
            await source(urls[0]),
            urls[0],
            identity,
            filing,
            company,
            basicPeriods
          );
          if (!periods.length)
            throw Error("Reviewed original standalone layout did not yield a business partition.");
          company = publish(company, periods);
        } catch (error) {
          warnings.push(
            `${filing.reportDate}: standalone source: ${error instanceof Error ? error.message : error}`
          );
        }
        // Standalone reports have no inline declarations; the previous inline
        // reader has no new periods to compare from this original source.
        continue;
      }
      company = publish(
        company,
        readGenericFiling(html, identity, filing, company, basicPeriods, industrySic)
      );
      // Previous engine: standard inline concepts, then business rows.
      const parsed = parseInlineXbrl(html);
      const updated = new Map(
        (previous ? genericCandidates(previous, basicPeriods) : []).map((p) => [p.id, p])
      );
      const changes = new Map<string, PeriodV2>();
      for (const p of enrichInlinePeriods(html, identity, filing, [...updated.values()], parsed)) {
        updated.set(p.id, p);
        changes.set(p.id, p);
      }
      for (const p of enrichBusinessPeriods(html, identity, filing, [...updated.values()], parsed))
        changes.set(p.id, p);
      previous = publish(previous, [...changes.values()]);
    } catch (error) {
      warnings.push(`${filing.reportDate}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (!company)
    throw new Error("No supported, source-linked financial periods after source review.");
  const annual = company.annual.map(summarize);
  const quarterly = company.quarterly.map(summarize);
  const all = [...annual, ...quarterly];
  const report: CompanyReport = {
    ticker: identity.ticker,
    sector: identity.sector,
    status: "ok",
    annual,
    quarterly,
    sankey: `${all.filter((p) => p.sankey).length}/${all.length}`,
    segments: `${all.filter((p) => p.segments).length}/${all.length}`,
    latestAnnualSankey: annual.at(-1)?.sankey ?? false,
    latestQuarterSankey: quarterly.at(-1)?.sankey ?? false,
    previousLatestAnnualSankey: previous?.annual.at(-1)?.coverage.sankey ?? false,
    previousSankey: `${[...(previous?.annual ?? []), ...(previous?.quarterly ?? [])].filter((p) => p.coverage.sankey).length}/${(previous?.annual.length ?? 0) + (previous?.quarterly.length ?? 0)}`,
    filingsRead: todo.length,
    warnings: [...new Set(warnings)]
  };
  return { report, company };
}

export async function auditCompany(identity: CatalogCompany, source: AuditSource, maxFilings = 30) {
  return (await auditCompanyDataset(identity, source, maxFilings)).report;
}
