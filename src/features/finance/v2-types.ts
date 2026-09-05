import type { CompanyDataset, FinancialMetrics, FinancialPeriod } from "./types";

export type MetricSource = {
  label: string;
  tag: string;
  accession: string;
  filedAt: string;
  sourceUrl: string;
  method: "reported" | "calculated";
  inputs?: string[];
};
export type PeriodV2 = Omit<FinancialPeriod, "metrics" | "displayCurrency"> & {
  displayCurrency: string;
  metrics: Partial<FinancialMetrics>;
  metricSources: Partial<Record<keyof FinancialMetrics, MetricSource>>;
  coverage: { basics: boolean; segments: boolean; sankey: boolean };
};
export type CompanyV2 = Omit<CompanyDataset, "schemaVersion" | "annual" | "quarterly"> & {
  schemaVersion: 2;
  annual: PeriodV2[];
  quarterly: PeriodV2[];
  checkedAt?: string;
  warnings: string[];
};
export type FinanceHistory = {
  schemaVersion: 2;
  capturedAt: string;
  companies: CompanyV2[];
};
export type CatalogCompany = {
  ticker: string;
  name: string;
  cik: string;
  sector: string;
  universe: "sp500" | "additional";
};
export type FinanceCatalog = {
  schemaVersion: 2;
  asOf: string;
  sourceUrl: string;
  sourceHash: string;
  secMapping?: { sourceUrl: string; checkedAt: string; sourceHash: string };
  companies: CatalogCompany[];
};
export type JobState =
  | "queued"
  | "fetching"
  | "validating"
  | "backfilling"
  | "ready"
  | "partial"
  | "failed"
  | "unchanged";
export type FinanceJob = {
  id: string;
  ticker: string;
  cik: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  message: string;
  completed: number;
  total: number;
  retryAt?: string;
};
export const pendingJob = (job?: FinanceJob | null) =>
  !!job && ["queued", "fetching", "validating", "backfilling"].includes(job.state);
export type CompanyResponse = {
  company: CompanyV2 | null;
  job: FinanceJob | null;
  available: boolean;
};
