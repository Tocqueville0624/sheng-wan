import { buildStatementFlow } from "../../src/features/finance/chart-model";
import type {
  CompanyDataset,
  FinancialMetrics,
  FinancialPeriod
} from "../../src/features/finance/types";
import type { CompanyV2, PeriodV2, MetricSource } from "../../src/features/finance/v2-types";
import { validatePeriod, validateSegmentGrossProfits, roundingTolerance } from "./validate";

export function statementPeriod(period: PeriodV2): FinancialPeriod | undefined {
  if (period.displayCurrency !== "USD") return;
  const required = [
    "revenue",
    "costOfRevenue",
    "grossProfit",
    "operatingExpenses",
    "operatingIncome",
    "pretaxIncome",
    "incomeTax",
    "netIncome"
  ] as const;
  if (required.some((key) => !Number.isFinite(period.metrics[key]))) return;
  const statement = period as FinancialPeriod;
  try {
    validatePeriod(statement);
    return statement;
  } catch {
    return;
  }
}

export function upgradePeriod(period: FinancialPeriod): PeriodV2 {
  const metricSources: PeriodV2["metricSources"] = {};
  for (const key of Object.keys(period.metrics) as (keyof FinancialMetrics)[]) {
    if (period.metrics[key] === undefined) continue;
    metricSources[key] = {
      label: key,
      tag: "reviewed-filing-adapter",
      accession: period.accession ?? "",
      filedAt: period.filedAt,
      sourceUrl: period.sourceUrl,
      method: period.derived ? "calculated" : "reported"
    };
  }
  return {
    ...period,
    metrics: Object.fromEntries(
      Object.entries(period.metrics).filter(([, value]) => value !== undefined)
    ),
    metricSources,
    coverage: {
      basics: true,
      segments: !!period.segments?.length,
      sankey: buildStatementFlow(period).ok
    }
  };
}

export function upgradeCompany(company: CompanyDataset): CompanyV2 {
  return {
    ...company,
    schemaVersion: 2,
    annual: company.annual.map(upgradePeriod),
    quarterly: company.quarterly.map(upgradePeriod),
    warnings: []
  };
}

export function validateV2(company: CompanyV2) {
  if (
    company.schemaVersion !== 2 ||
    !/^\d{10}$/.test(company.cik) ||
    !["verified", "delayed"].includes(company.dataStatus) ||
    !company.version ||
    !Number.isFinite(Date.parse(company.updatedAt)) ||
    Date.parse(company.updatedAt) > Date.now() + 60000 ||
    typeof company.name !== "string" ||
    !Array.isArray(company.warnings) ||
    !Array.isArray(company.annual) ||
    !Array.isArray(company.quarterly)
  )
    throw new Error("Unverified company identity or schema.");
  if (![...company.annual, ...company.quarterly].length)
    throw new Error("No source-available financial periods.");
  for (const kind of ["annual", "quarterly"] as const) {
    const ids = new Set<string>();
    for (const p of company[kind]) {
      if (ids.has(p.id) || p.kind !== kind) throw new Error("Duplicate or misplaced period.");
      ids.add(p.id);
      const issuerSource = (value: string) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "www.sec.gov" &&
          url.pathname.startsWith(`/Archives/edgar/data/${Number(company.cik)}/`) &&
          !url.username &&
          !url.password
        );
      };
      if (
        !issuerSource(p.sourceUrl) ||
        !/^[A-Z]{3}$/.test(p.displayCurrency) ||
        !p.coverage ||
        !Number.isInteger(p.fiscalYear) ||
        (kind === "quarterly" && ![1, 2, 3, 4].includes(p.fiscalQuarter!))
      )
        throw new Error("Invalid period identity, currency or source.");
      if (
        ![p.startDate, p.endDate, p.filedAt].every(
          (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
        ) ||
        p.startDate >= p.endDate ||
        p.endDate > p.filedAt ||
        p.filedAt > new Date().toISOString().slice(0, 10)
      )
        throw new Error("Invalid financial period dates.");
      const entries = Object.entries(p.metrics) as [keyof FinancialMetrics, number][];
      if (
        !entries.length ||
        entries.some(([key, value]) => !Number.isFinite(value) || !p.metricSources[key])
      )
        throw new Error("Missing metric provenance.");
      for (const [, source] of Object.entries(p.metricSources) as [string, MetricSource][]) {
        if (
          !issuerSource(source.sourceUrl) ||
          !["reported", "calculated"].includes(source.method) ||
          !source.tag ||
          !source.label ||
          source.filedAt !== p.filedAt
        )
          throw new Error("Metric source does not match the SEC issuer.");
      }
      const m = p.metrics;
      validateSegmentGrossProfits(p);
      const adjustments = p.grossProfitAdjustments ?? [];
      if (
        adjustments.some(
          (item) => !item.label || !Number.isFinite(item.amount) || item.sourceUrl !== p.sourceUrl
        )
      )
        throw new Error("Invalid reported gross profit adjustment provenance.");
      const tol = roundingTolerance(m.revenue ?? m.netIncome ?? 1);
      if (
        m.revenue !== undefined &&
        m.costOfRevenue !== undefined &&
        m.grossProfit !== undefined &&
        Math.abs(
          m.revenue -
            m.costOfRevenue +
            adjustments.reduce((sum, item) => sum + item.amount, 0) -
            m.grossProfit
        ) > tol
      )
        throw new Error("Gross profit does not reconcile.");
      if (
        m.grossProfit !== undefined &&
        m.operatingExpenses !== undefined &&
        m.operatingIncome !== undefined &&
        Math.abs(m.grossProfit - m.operatingExpenses - m.operatingIncome) > tol
      )
        throw new Error("Operating profit does not reconcile.");
      // NetIncomeLoss and ProfitLoss can differ in noncontrolling/equity scope.
      // Only claim a full statement when the reviewed accounting contract passes.
      if (p.coverage.segments || p.coverage.sankey) {
        const statement = statementPeriod(p);
        if (
          !statement ||
          (p.coverage.segments && !p.segments?.length) ||
          (p.coverage.sankey && !buildStatementFlow(statement).ok)
        )
          throw new Error("Unsupported chart capability.");
      }
    }
  }
}

/** Never splice basic facts into an older detailed statement: keep each version coherent. */
export function mergeV2(previous: CompanyV2 | undefined, incoming: CompanyV2): CompanyV2 {
  validateV2(incoming);
  if (previous && previous.cik !== incoming.cik) throw new Error("Issuer mismatch.");
  const merged = { ...incoming, warnings: [...new Set(incoming.warnings)] };
  for (const kind of ["annual", "quarterly"] as const) {
    const byDates = new Map(
      (previous?.[kind] ?? []).map((p) => [`${p.startDate}:${p.endDate}`, p])
    );
    for (const p of incoming[kind]) {
      const key = `${p.startDate}:${p.endDate}`;
      const old = byDates.get(key);
      if (old && (old.filedAt > p.filedAt || (old.coverage.segments && !p.coverage.segments))) {
        if (p.filedAt > old.filedAt)
          merged.warnings.push(
            `${p.label}: a newer basic filing exists, but the prior coherent business breakdown is retained until its updated adapter validates. Displayed figures cite ${old.filedAt}.`
          );
        continue;
      }
      if (
        old &&
        p.filedAt === old.filedAt &&
        Object.keys(old.metrics).length > Object.keys(p.metrics).length
      )
        continue;
      if (old && sameStatementExceptSegmentGrossProfit(old, p)) {
        // A legacy same-filing response may omit optional gross-profit fields.
        // Retain only the missing source/value pairs; never splice across filings
        // or across a changed category, currency, amount, or statement metric.
        byDates.set(key, {
          ...p,
          segments: p.segments?.map((segment) => {
            const prior = old.segments?.find((candidate) => candidate.id === segment.id);
            return segment.grossProfit === undefined && prior?.grossProfit !== undefined
              ? {
                  ...segment,
                  grossProfit: prior.grossProfit,
                  grossProfitSource: prior.grossProfitSource
                }
              : segment;
          })
        });
        continue;
      }
      byDates.set(key, p);
    }
    merged[kind] = [...byDates.values()]
      .sort((a, b) => a.endDate.localeCompare(b.endDate))
      .slice(kind === "annual" ? -10 : -20);
  }
  merged.latestPeriod = [...merged.annual, ...merged.quarterly]
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .at(-1)!.label;
  validateV2(merged);
  return merged;
}

function sameStatementExceptSegmentGrossProfit(a: PeriodV2, b: PeriodV2) {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  const withoutGrossProfit = (period: PeriodV2) => ({
    ...period,
    segments: period.segments?.map((segment) => ({
      id: segment.id,
      label: segment.label,
      revenue: segment.revenue
    }))
  });
  return stable(withoutGrossProfit(a)) === stable(withoutGrossProfit(b));
}
