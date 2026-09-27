export type PeriodKind = "annual" | "quarterly";
export type DataStatus = "verified" | "delayed" | "demo";

export type FinancialMetrics = {
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  totalOperatingCosts?: number;
  operatingIncome: number;
  pretaxIncome: number;
  incomeTax: number;
  netIncome: number;
  researchAndDevelopment?: number;
  sellingGeneralAndAdministrative?: number;
  equityMethodIncome?: number;
  /** Signed income attributable to noncontrolling interests, deducted from consolidated income. */
  noncontrollingInterestIncome?: number;
};

export type SegmentGrossProfitSource = {
  sourceUrl: string;
  accession?: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  reportingCurrency: string;
  method: "reported" | "revenue-minus-cost";
  revenueTag: string;
  tag: string;
  dimensions: Record<string, string>;
  /** The original reported gross profit or cost, before any display-currency conversion. */
  value: number;
};

export type RevenueSegment = {
  id: string;
  label: string;
  revenue: number;
  grossProfit?: number;
  grossProfitSource?: SegmentGrossProfitSource;
  revenueSource?: {
    sourceUrl: string;
    accession: string;
    filedAt: string;
    startDate: string;
    endDate: string;
    currency: string;
    tag: string;
    dimensions: Record<string, string>;
    value: number;
    decimals: number;
    /** Visible row label from the cited statement table, not a guessed taxonomy name. */
    tableLabel: string;
  };
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
  /** Source-supported rounding: revenue - total operating costs + amount = operating income. */
  operatingReconciliation?: { label: string; amount: number; sourceUrl: string };
  segments?: RevenueSegment[];
  revenueAdjustments?: RevenueSegment[];
  operatingExpenseDetails?: { id: string; label: string; amount: number }[];
  segmentSourceUrl?: string;
  segmentBasis?: string;
  businessBreakdownSource?: {
    method: "statement-revenue-rows";
    tableIndex: number;
    sourceUrl: string;
    accession: string;
    revenueTag: string;
    revenue: number;
    revenueDecimals: number;
    axis?: string;
    totalLabel: string;
    /** Explicit table subtotals omitted so their child rows are counted only once. */
    omittedSubtotals: {
      label: string;
      tag: string;
      dimensions: Record<string, string>;
      value: number;
    }[];
  };
};

/** Revenue history does not require every cost and profit subtotal to be available. */
export type BusinessPeriod = Omit<FinancialPeriod, "metrics"> & {
  metrics: Pick<FinancialMetrics, "revenue"> & Partial<FinancialMetrics>;
};

/** A reconciled flow can omit the gross-profit stage when the filing does. */
export type FlowStatementPeriod = Omit<FinancialPeriod, "metrics"> & {
  metrics: Pick<
    FinancialMetrics,
    "revenue" | "operatingIncome" | "pretaxIncome" | "incomeTax" | "netIncome"
  > &
    Partial<FinancialMetrics>;
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
