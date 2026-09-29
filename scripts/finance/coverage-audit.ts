import { buildStatementFlow } from "../../src/features/finance/chart-model";
import type { FlowStatementPeriod } from "../../src/features/finance/types";
import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import { enrichBusinessPeriods } from "./business-v2";
import { extractFactsV2, parseFactsDocument } from "./facts-v2";
import { genericCandidates, genericFilingTodo, readGenericFiling } from "./generic-import";
import { enrichInlinePeriods } from "./inline-v2";
import { parseInlineXbrl } from "./ixbrl";
import { parseFilings, type RecentFilings, type SecFiling, type Submissions } from "./sec-shared";
import { flowPeriod, mergeV2, normalizeBasicCompany } from "./v2-model";

/** Returns an SEC response body; the CLI caches, tests may supply fixtures. */
export type AuditSource = (url: string, maxAgeMs?: number) => Promise<string>;

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
export async function auditCompany(
  identity: CatalogCompany,
  source: AuditSource,
  maxFilings = 30
): Promise<CompanyReport> {
  const submissions = JSON.parse(
    await source(`https://data.sec.gov/submissions/CIK${identity.cik}.json`, 60 * 60 * 1000)
  ) as Submissions;
  if (String(submissions.cik).padStart(10, "0") !== identity.cik)
    throw new Error("SEC issuer identity mismatch.");
  const industrySic = /^\d{4}$/.test(submissions.sic ?? "") ? submissions.sic : undefined;
  const cutoff = `${new Date().getUTCFullYear() - 11}-01-01`;
  let filings: SecFiling[] = parseFilings(identity.cik, submissions.filings.recent).filter((f) =>
    /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
  );
  const archives = submissions.filings.files
    .filter((f) => f.filingTo >= cutoff && /^CIK\d+-submissions-\d+\.json$/.test(f.name))
    .sort((a, b) => b.filingTo.localeCompare(a.filingTo))
    .map((f) => f.name)
    .slice(0, 160);
  for (const name of archives) {
    const archive = JSON.parse(
      await source(`https://data.sec.gov/submissions/${name}`)
    ) as RecentFilings;
    const all = [
      ...filings,
      ...parseFilings(identity.cik, archive).filter((f) =>
        /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(f.form)
      )
    ];
    filings = [...new Map(all.map((f) => [f.accession, f])).values()]
      .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
      .slice(0, 700);
  }
  const facts = parseFactsDocument(
    await source(`https://data.sec.gov/api/xbrl/companyfacts/CIK${identity.cik}.json`)
  );
  const basic = extractFactsV2(facts, identity, filings, undefined, industrySic);
  let company: CompanyV2 = normalizeBasicCompany(
    mergeV2(undefined, { ...basic, version: "audit" })
  );
  let previous = company;
  const basicPeriods = [...basic.annual, ...basic.quarterly];
  const todo = genericFilingTodo(company, basicPeriods, filings, maxFilings);
  const warnings = [...company.warnings];
  const publish = (base: CompanyV2, periods: PeriodV2[]) =>
    periods.length
      ? mergeV2(base, {
          ...base,
          annual: periods.filter((p) => p.kind === "annual"),
          quarterly: periods.filter((p) => p.kind === "quarterly")
        })
      : base;
  for (const filing of todo) {
    try {
      const html = await source(filing.sourceUrl);
      company = publish(company, readGenericFiling(html, identity, filing, company, basicPeriods));
      // Previous engine: standard inline concepts, then business rows.
      const parsed = parseInlineXbrl(html);
      const updated = new Map(genericCandidates(previous, basicPeriods).map((p) => [p.id, p]));
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
  const annual = company.annual.map(summarize);
  const quarterly = company.quarterly.map(summarize);
  const all = [...annual, ...quarterly];
  return {
    ticker: identity.ticker,
    sector: identity.sector,
    status: "ok",
    annual,
    quarterly,
    sankey: `${all.filter((p) => p.sankey).length}/${all.length}`,
    segments: `${all.filter((p) => p.segments).length}/${all.length}`,
    latestAnnualSankey: annual.at(-1)?.sankey ?? false,
    latestQuarterSankey: quarterly.at(-1)?.sankey ?? false,
    previousLatestAnnualSankey: previous.annual.at(-1)?.coverage.sankey ?? false,
    previousSankey: `${[...previous.annual, ...previous.quarterly].filter((p) => p.coverage.sankey).length}/${previous.annual.length + previous.quarterly.length}`,
    filingsRead: todo.length,
    warnings: [...new Set(warnings)]
  };
}
