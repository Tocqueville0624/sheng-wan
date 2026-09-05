import { companies } from "./companies";
import { curatedDatasets } from "./curated";
import { validateManifest } from "./validate";
import type {
  CompanyDataset,
  FinanceManifest,
  FinancialPeriod
} from "../../src/features/finance/types";

function mergePeriods(current: FinancialPeriod[], additions: FinancialPeriod[]) {
  const merged = new Map(
    current.map((period) => [`${period.startDate}:${period.endDate}`, period])
  );
  for (const addition of additions) {
    const key = `${addition.startDate}:${addition.endDate}`;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, addition);
    } else if (!prior.segments && prior.metrics.revenue === addition.metrics.revenue) {
      // Supplement only exactly reconciled, same-duration revenue. Do not overwrite
      // a newer/restated statement's other metrics with an older curated statement.
      merged.set(key, {
        ...prior,
        segments: addition.segments,
        segmentSourceUrl: addition.segmentSourceUrl,
        segmentBasis: addition.segmentBasis
      });
    }
  }
  return [...merged.values()].sort((a, b) => a.endDate.localeCompare(b.endDate));
}

export function applyCuratedData(input: FinanceManifest): FinanceManifest {
  const allowed = new Set(companies.map((company) => company.ticker));
  const datasets = new Map(
    input.companies
      .filter((company) => allowed.has(company.ticker))
      .map((company) => [company.ticker, company])
  );
  for (const curated of curatedDatasets()) {
    const current = datasets.get(curated.ticker);
    if (!current || current.dataStatus === "demo") {
      datasets.set(curated.ticker, curated);
      continue;
    }
    const annual = mergePeriods(current.annual, curated.annual);
    const quarterly = mergePeriods(current.quarterly, curated.quarterly);
    const next: CompanyDataset = { ...current, annual, quarterly };
    next.latestPeriod = quarterly.at(-1)?.label ?? annual.at(-1)!.label;
    datasets.set(curated.ticker, next);
  }
  const result = [...datasets.values()];
  const hasDemo = result.some((company) => company.dataStatus === "demo");
  const hasDelayed = result.some((company) => company.dataStatus === "delayed");
  const manifest: FinanceManifest = {
    ...input,
    dataStatus: hasDemo ? "demo" : hasDelayed ? "delayed" : "verified",
    note: hasDemo
      ? "Mixed coverage: Apple contains source-checked GAAP statements and product/service revenue. Other companies are explicitly labeled synthetic design previews, not financial analysis."
      : undefined,
    companies: result
  };
  validateManifest(manifest);
  return manifest;
}

export function assertNoVerifiedDowngrade(
  previous: FinanceManifest | undefined,
  next: FinanceManifest
) {
  const allowed = new Set(companies.map((company) => company.ticker));
  for (const company of previous?.companies ?? []) {
    if (company.dataStatus === "demo" || !allowed.has(company.ticker)) continue;
    const replacement = next.companies.find((entry) => entry.ticker === company.ticker);
    if (!replacement)
      throw new Error(`${company.ticker}: refusing to remove verified data during refresh.`);
    if (replacement?.dataStatus === "demo")
      throw new Error(`${company.ticker}: refusing to replace verified data with a demo.`);
  }
}
