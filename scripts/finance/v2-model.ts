import { buildStatementFlow, segmentProblem } from "../../src/features/finance/chart-model";
import type {
  CompanyDataset,
  FinancialMetrics,
  FinancialPeriod,
  FlowStatementPeriod,
  BusinessPeriod
} from "../../src/features/finance/types";
import type { CompanyV2, PeriodV2, MetricSource } from "../../src/features/finance/v2-types";
import { validatePeriod, validateSegmentGrossProfits, roundingTolerance } from "./validate";
import { businessRules, sameDimensions } from "../../src/features/finance/business-rules";

/** Standard cost tags can describe only one activity (for example franchise rent).
 * A generic revenue-minus-cost residual is not a reported consolidated gross profit.
 * Require an independent reported operating-expense subtotal to corroborate it.
 * This also repairs previously stored basic imports without another SEC crawl.
 */
export function normalizeBasicPeriod(period: PeriodV2): PeriodV2 {
  if (
    period.coverage.segments ||
    period.metricSources.grossProfit?.tag !== "revenue - costOfRevenue"
  )
    return period;
  const m = period.metrics;
  if (
    period.metricSources.operatingExpenses?.method === "reported" &&
    m.operatingExpenses !== undefined &&
    m.operatingIncome !== undefined &&
    m.grossProfit !== undefined &&
    Math.abs(m.grossProfit - m.operatingExpenses - m.operatingIncome) <=
      roundingTolerance(m.revenue ?? 1)
  )
    return period;
  const next: PeriodV2 = {
    ...period,
    metrics: { ...period.metrics },
    metricSources: { ...period.metricSources },
    coverage: { ...period.coverage, sankey: false }
  };
  delete next.metrics.grossProfit;
  delete next.metricSources.grossProfit;
  if (next.metricSources.operatingExpenses?.tag === "grossProfit - operatingIncome") {
    delete next.metrics.operatingExpenses;
    delete next.metricSources.operatingExpenses;
  }
  next.derived = Object.values(next.metricSources).some((source) => source.method === "calculated");
  return next;
}

export function normalizeBasicCompany(company: CompanyV2): CompanyV2 {
  const annual = company.annual.map(normalizeBasicPeriod);
  const quarterly = company.quarterly.map(normalizeBasicPeriod);
  if (
    annual.every((p, i) => p === company.annual[i]) &&
    quarterly.every((p, i) => p === company.quarterly[i])
  )
    return company;
  return {
    ...company,
    annual,
    quarterly,
    version: `${company.version}-scope2`,
    warnings: [
      ...new Set([
        ...company.warnings,
        "Gross profit inferred from an unreviewed cost tag is withheld unless independent reported subtotals confirm its scope. Reported revenue and income remain available."
      ])
    ]
  };
}

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

/** Financial flows need a reconciled statement, but not necessarily a gross-profit subtotal. */
export function businessPeriod(period: PeriodV2): BusinessPeriod | undefined {
  if (period.displayCurrency !== "USD" || !Number.isFinite(period.metrics.revenue)) return;
  const business = period as BusinessPeriod;
  if (
    segmentProblem(business) ||
    !period.segmentBasis ||
    period.segmentSourceUrl !== period.sourceUrl
  )
    return;
  const proof = period.businessBreakdownSource;
  if (!proof) {
    // Existing reviewed adapters retain their contract and reported adjustments.
    if (period.revenueAdjustments?.some((item) => item.id === "source-rounding")) return;
    return business;
  }
  const qname = /^[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*$/;
  const rule =
    proof.method === "reviewed-segment-table"
      ? businessRules.find((r) => r.id === proof.ruleId)
      : undefined;
  if (
    proof.method === "reviewed-segment-table" &&
    (!rule ||
      !period.sourceUrl.startsWith(
        `https://www.sec.gov/Archives/edgar/data/${Number(rule.cik)}/`
      ) ||
      proof.revenueTag !== rule.totalTag ||
      proof.totalLabel !== rule.totalLabel ||
      proof.axis ||
      !!rule.separateTotal !== (proof.totalTableIndex !== undefined) ||
      (proof.totalTableIndex !== undefined &&
        (!Number.isInteger(proof.totalTableIndex) || proof.totalTableIndex < 0)) ||
      period.segments!.length !== rule.branches.length)
  )
    return;
  const halfUnit = (decimals: number) =>
    Number.isInteger(decimals) && decimals >= -18 && decimals <= 18 ? 0.5 * 10 ** -decimals : NaN;
  if (
    !["statement-revenue-rows", "reviewed-segment-table"].includes(proof.method) ||
    !Number.isInteger(proof.tableIndex) ||
    proof.tableIndex < 0 ||
    proof.sourceUrl !== period.sourceUrl ||
    proof.accession !== period.accession ||
    proof.revenue !== period.metrics.revenue ||
    proof.revenueTag !== period.metricSources.revenue?.tag ||
    !proof.totalLabel ||
    !Number.isFinite(halfUnit(proof.revenueDecimals)) ||
    (proof.axis &&
      ![
        "srt:ProductOrServiceAxis",
        "us-gaap:ProductOrServiceAxis",
        "us-gaap:StatementBusinessSegmentsAxis"
      ].includes(proof.axis))
  )
    return;
  const keys = new Set<string>();
  for (const segment of period.segments!) {
    const source = segment.revenueSource;
    const reviewed = rule?.branches.find((b) => b.label === segment.label);
    const dimensionsValid = rule
      ? !!reviewed &&
        !!source?.dimensions &&
        source.tag === reviewed.tag &&
        source.rowLabel === reviewed.rowLabel &&
        sameDimensions(source.dimensions, reviewed.dimensions)
      : !!source?.dimensions &&
        Object.keys(source.dimensions).length === (proof.axis ? 1 : 0) &&
        Object.entries(source.dimensions).every(
          ([axis, member]) => axis === proof.axis && qname.test(member)
        );
    if (
      !source ||
      source.sourceUrl !== period.sourceUrl ||
      source.accession !== period.accession ||
      source.filedAt !== period.filedAt ||
      source.startDate !== period.startDate ||
      source.endDate !== period.endDate ||
      source.currency !== period.displayCurrency ||
      source.currency !== period.reportingCurrency ||
      source.value !== segment.revenue ||
      source.tableLabel !== segment.label ||
      !source.tableLabel ||
      !qname.test(source.tag) ||
      !Number.isFinite(halfUnit(source.decimals)) ||
      !source.dimensions ||
      !dimensionsValid
    )
      return;
    const key = `${source.tag}|${JSON.stringify(source.dimensions)}`;
    if (keys.has(key)) return;
    keys.add(key);
    const grossSource = segment.grossProfitSource;
    if (
      grossSource &&
      (!grossSource.dimensions ||
        grossSource.revenueTag !== source.tag ||
        JSON.stringify(Object.entries(grossSource.dimensions).sort()) !==
          JSON.stringify(Object.entries(source.dimensions).sort()))
    )
      return;
  }
  const adjustments = period.revenueAdjustments ?? [];
  if (
    adjustments.length > 1 ||
    adjustments.some((a) => a.id !== "source-rounding" || a.label !== "Source rounding")
  )
    return;
  const amount = adjustments[0]?.revenue ?? 0;
  const bound = period.segments!.reduce(
    (sum, s) => sum + halfUnit(s.revenueSource!.decimals),
    halfUnit(proof.revenueDecimals)
  );
  if (Math.abs(amount) > bound || Math.abs(amount) > proof.revenue * 0.001) return;
  try {
    validateSegmentGrossProfits(period);
  } catch {
    return;
  }
  return business;
}

export function flowPeriod(period: PeriodV2): FlowStatementPeriod | undefined {
  if (period.displayCurrency !== "USD") return;
  if (period.businessBreakdownSource && !businessPeriod(period)) return;
  const required = ["revenue", "pretaxIncome", "incomeTax", "netIncome"] as const;
  if (required.some((key) => !Number.isFinite(period.metrics[key]))) return;
  if (Number.isFinite(period.metrics.operatingIncome)) {
    if (!Number.isFinite(period.metrics.grossProfit) && !period.metricSources.totalOperatingCosts)
      return;
  } else if (
    // Only a statement without an operating line may use one net amount before pretax.
    !Number.isFinite(period.metrics.expensesAndOtherItems) ||
    !period.metricSources.expensesAndOtherItems ||
    period.metricSources.expensesAndOtherItems.accession !== period.accession
  )
    return;
  if (period.operatingReconciliation) {
    const item = period.operatingReconciliation;
    const keys = ["revenue", "totalOperatingCosts", "operatingIncome"] as const;
    if (
      item.label !== "Source rounding" ||
      item.sourceUrl !== period.sourceUrl ||
      !Number.isFinite(item.amount)
    )
      return;
    if (
      keys.some((key) => {
        const source = period.metricSources[key];
        return (
          !source ||
          source.method !== "reported" ||
          !Number.isFinite(source.decimals) ||
          source.accession !== period.accession ||
          source.sourceUrl !== period.sourceUrl ||
          source.filedAt !== period.filedAt
        );
      })
    )
      return;
    const bound = keys.reduce(
      (sum, key) => sum + 0.5 * 10 ** -period.metricSources[key]!.decimals!,
      0
    );
    if (
      Math.abs(item.amount) > bound ||
      Math.abs(item.amount) > Math.abs(period.metrics.revenue!) * 0.001
    )
      return;
  }
  const statement = period as FlowStatementPeriod;
  return buildStatementFlow(statement).ok ? statement : undefined;
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
      if (p.coverage.segments) {
        if (!businessPeriod(p)) throw new Error("Unsupported business chart capability.");
      }
      if (p.businessBreakdownSource && !p.coverage.segments)
        throw new Error("Business provenance requires validated coverage.");
      if ((p.coverage.sankey || p.operatingReconciliation) && !flowPeriod(p))
        throw new Error("Unsupported chart capability or unverified rounding precision.");
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
        old.accession === p.accession &&
        old.coverage.sankey &&
        !p.coverage.sankey
      )
        continue;
      if (
        old &&
        p.filedAt === old.filedAt &&
        !(p.coverage.sankey && !old.coverage.sankey) &&
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
