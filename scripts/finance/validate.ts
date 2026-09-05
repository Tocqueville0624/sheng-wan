import type {
  CompanyDataset,
  FinanceManifest,
  FinancialMetrics,
  FinancialPeriod
} from "../../src/features/finance/types";

// Dollar-denominated floating-point tolerance, not permission to alter a reported flow.
export const roundingTolerance = (revenue: number) => Math.max(0.000001, Math.abs(revenue) * 1e-9);

export function isReconciled(metrics: FinancialMetrics, grossAdjustment = 0) {
  if (Object.values(metrics).some((value) => value !== undefined && !Number.isFinite(value)))
    return false;
  const tolerance = roundingTolerance(metrics.revenue);
  return (
    Math.abs(metrics.revenue - metrics.costOfRevenue + grossAdjustment - metrics.grossProfit) <=
      tolerance &&
    Math.abs(metrics.grossProfit - metrics.operatingExpenses - metrics.operatingIncome) <=
      tolerance &&
    Math.abs(
      metrics.pretaxIncome -
        metrics.incomeTax +
        (metrics.equityMethodIncome ?? 0) -
        metrics.netIncome
    ) <= tolerance
  );
}

export function validatePeriod(period: FinancialPeriod) {
  const adjustments = period.grossProfitAdjustments ?? [];
  if (
    adjustments.some(
      (item) => !item.label || !Number.isFinite(item.amount) || item.sourceUrl !== period.sourceUrl
    )
  )
    throw new Error(`${period.id}: invalid reported gross profit adjustments.`);
  if (
    !isReconciled(
      period.metrics,
      adjustments.reduce((sum, item) => sum + item.amount, 0)
    )
  )
    throw new Error(`${period.id}: accounting identities fail.`);
  if (!(period.metrics.revenue > 0)) throw new Error(`${period.id}: revenue must be positive.`);
  if (period.metrics.costOfRevenue < 0 || period.metrics.operatingExpenses < 0)
    throw new Error(`${period.id}: expenses must not be negative.`);
  if (
    !Number.isFinite(Date.parse(period.startDate)) ||
    !Number.isFinite(Date.parse(period.endDate))
  )
    throw new Error(`${period.id}: invalid statement dates.`);
  if (period.startDate >= period.endDate) throw new Error(`${period.id}: invalid duration.`);
  const detail =
    (period.metrics.researchAndDevelopment ?? 0) +
    (period.metrics.sellingGeneralAndAdministrative ?? 0);
  if (
    (period.metrics.researchAndDevelopment ?? 0) < 0 ||
    (period.metrics.sellingGeneralAndAdministrative ?? 0) < 0 ||
    detail - period.metrics.operatingExpenses > roundingTolerance(period.metrics.revenue)
  )
    throw new Error(`${period.id}: operating expense detail does not reconcile.`);
  if (period.operatingExpenseDetails) {
    const details = period.operatingExpenseDetails;
    if (
      !details.length ||
      new Set(details.map((item) => item.id)).size !== details.length ||
      details.some(
        (item) => !item.id || !item.label || !Number.isFinite(item.amount) || item.amount < 0
      )
    )
      throw new Error(`${period.id}: invalid named operating expenses.`);
    if (
      Math.abs(
        details.reduce((sum, item) => sum + item.amount, 0) - period.metrics.operatingExpenses
      ) > roundingTolerance(period.metrics.revenue)
    )
      throw new Error(`${period.id}: named operating expenses do not reconcile.`);
  }
  if (period.segments) {
    const ids = new Set(period.segments.map((segment) => segment.id));
    if (
      !period.segments.length ||
      ids.size !== period.segments.length ||
      period.segments.some(
        (segment) =>
          !segment.id || !segment.label || !Number.isFinite(segment.revenue) || segment.revenue < 0
      )
    )
      throw new Error(`${period.id}: invalid business revenue categories.`);
    if (!period.segmentSourceUrl || !period.segmentBasis)
      throw new Error(`${period.id}: business revenue categories require provenance.`);
    const adjustments = period.revenueAdjustments ?? [];
    const adjustmentIds = new Set(adjustments.map((adjustment) => adjustment.id));
    if (
      adjustmentIds.size !== adjustments.length ||
      adjustments.some(
        (adjustment) =>
          !adjustment.id ||
          !adjustment.label ||
          !Number.isFinite(adjustment.revenue) ||
          ids.has(adjustment.id)
      )
    )
      throw new Error(`${period.id}: invalid reported revenue adjustments.`);
    const total = [...period.segments, ...adjustments].reduce(
      (sum, segment) => sum + segment.revenue,
      0
    );
    if (Math.abs(total - period.metrics.revenue) > roundingTolerance(period.metrics.revenue))
      throw new Error(`${period.id}: business revenue categories do not sum to revenue.`);
  } else if (period.revenueAdjustments?.length) {
    throw new Error(`${period.id}: revenue adjustments require a complete business breakdown.`);
  }
}

export function validateCompany(company: CompanyDataset) {
  for (const kind of ["annual", "quarterly"] as const) {
    const ids = new Set<string>();
    for (const period of company[kind]) {
      if (period.kind !== kind || ids.has(period.id))
        throw new Error(`${company.ticker}: duplicate or misplaced period ${period.id}.`);
      validatePeriod(period);
      ids.add(period.id);
    }
  }
}

export function validateManifest(manifest: FinanceManifest) {
  if (!manifest.companies.length) throw new Error("Finance snapshot has no companies.");
  const tickers = new Set<string>();
  for (const company of manifest.companies) {
    if (tickers.has(company.ticker)) throw new Error(`Duplicate company ${company.ticker}.`);
    validateCompany(company);
    tickers.add(company.ticker);
  }
  if (
    manifest.dataStatus === "verified" &&
    manifest.companies.some((company) => company.dataStatus !== "verified")
  )
    throw new Error("A mixed/demo snapshot cannot be marked verified.");
}

export function assertPublishableManifest(manifest: FinanceManifest) {
  validateManifest(manifest);
  if (!["verified", "delayed"].includes(manifest.dataStatus))
    throw new Error("Public finance snapshots cannot contain demo data.");
  for (const company of manifest.companies) {
    if (!["verified", "delayed"].includes(company.dataStatus))
      throw new Error(`${company.ticker}: unverified company cannot be published.`);
    if (!company.annual.length || !company.quarterly.length)
      throw new Error(`${company.ticker}: annual and quarterly source coverage is required.`);
    for (const period of [...company.annual, ...company.quarterly]) {
      if (!period.segments?.length || !period.segmentSourceUrl)
        throw new Error(`${company.ticker} ${period.id}: sourced business revenue is required.`);
    }
  }
}
