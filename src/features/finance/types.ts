export type PeriodKind = "annual" | "quarterly";
export type DataStatus = "verified" | "delayed" | "demo";

export type FinancialMetrics = {
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  pretaxIncome: number;
  incomeTax: number;
  netIncome: number;
  researchAndDevelopment?: number;
  sellingGeneralAndAdministrative?: number;
  equityMethodIncome?: number;
};

export type RevenueSegment = {
  id: string;
  label: string;
  revenue: number;
};

export type FinancialPeriod = {
  id: string;
  label: string;
  kind: PeriodKind;
  fiscalYear: number;
  fiscalQuarter?: 1 | 2 | 3 | 4;
  startDate: string;
  endDate: string;
  filedAt: string;
  accession?: string;
  sourceUrl: string;
  reportingCurrency: string;
  displayCurrency: "USD";
  fx?: {
    rate: number;
    unit: "TWD per USD";
    sourceUrl: string;
    startDate: string;
    endDate: string;
  };
  derived: boolean;
  metrics: FinancialMetrics;
  grossProfitAdjustments?: { label: string; amount: number; sourceUrl: string }[];
  segments?: RevenueSegment[];
  revenueAdjustments?: RevenueSegment[];
  operatingExpenseDetails?: { id: string; label: string; amount: number }[];
  segmentSourceUrl?: string;
  segmentBasis?: string;
};

export type CompanySummary = {
  ticker: string;
  name: string;
  cik: string;
  accent: string;
  reportingCurrency: string;
  latestPeriod: string;
  dataStatus: DataStatus;
};

export type CompanyDataset = CompanySummary & {
  schemaVersion: 1;
  version: string;
  updatedAt: string;
  note?: string;
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
};

export type FinanceManifest = {
  schemaVersion: 1;
  version: string;
  updatedAt: string;
  dataStatus: DataStatus;
  note?: string;
  companies: CompanyDataset[];
};

export type ApiError = {
  error: {
    code: "INVALID_PERIOD" | "UNSUPPORTED_COMPANY" | "DATA_UNAVAILABLE" | "NOT_FOUND";
    message: string;
  };
};
