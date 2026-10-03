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
  /** Signed after-tax income (loss) from unconsolidated subsidiaries, as reported. */
  afterTaxSubsidiaryIncome?: number;
  /** Signed income attributable to noncontrolling interests, deducted from consolidated income. */
  noncontrollingInterestIncome?: number;
  /** Signed after-tax income (loss) from discontinued operations, as reported. */
  discontinuedOperationsIncome?: number;
  /**
   * Statements without an operating-profit line: every item between revenue (or gross
   * profit) and pretax profit, net. Used only when operating income is not reported.
   */
  expensesAndOtherItems?: number;
};

/** A named, nonnegative statement line. Generic imports keep the reported concept and precision. */
export type StatementLine = {
  id: string;
  label: string;
  amount: number;
  tag?: string;
  decimals?: number;
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
    /** For reviewed vertical tables, the metric row below the named business section. */
    rowLabel?: string;
    /** Logical column in a source table whose business labels are column headers. */
    columnIndex?: number;
    /** Source row used to verify an explicitly reported segment reconciliation. */
    rowIndex?: number;
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
  operatingExpenseDetails?: StatementLine[];
  /**
   * Reported rows that exactly partition the direct route's cost node: total operating
   * costs, or expenses and other items when no operating-profit line is reported.
   */
  operatingCostDetails?: StatementLine[];
  segmentSourceUrl?: string;
  segmentBasis?: string;
  businessBreakdownSource?: {
    method: "statement-revenue-rows" | "statement-revenue-matrix" | "reviewed-segment-table";
    ruleId?: string;
    tableIndex: number;
    /** When the segment table omits a total, the primary consolidated table supplies it. */
    totalTableIndex?: number;
    sourceUrl: string;
    accession: string;
    revenueTag: string;
    revenue: number;
    revenueDecimals: number;
    axis?: string;
    /** Fixed business-row scope; a nondimensional consolidated total may reconcile it. */
    qualifiers?: Record<string, string>;
    /** Logical table column, counting colspans; cross-axis interior cells are excluded. */
    columnIndex?: number;
    layout?: "columns";
    headerRowIndex?: number;
    rowIndex?: number;
    /** Source-table total can be an explicitly labelled segment aggregate;
     * its amount is independently corroborated by the primary consolidated row. */
    totalDimensions?: Record<string, string>;
    totalLabel: string;
    /** Explicit corporate columns reported as zero; never guessed from a dash. */
    omittedZeroColumns?: {
      label: string;
      tag: string;
      dimensions: Record<string, string>;
      value: 0;
      decimals: number;
      columnIndex: number;
    }[];
    /** Explicit table subtotals omitted so their child rows are counted only once. */
    omittedSubtotals: {
      label: string;
      tag: string;
      dimensions: Record<string, string>;
      value: number;
      decimals?: number;
      columnIndex?: number;
      rowIndex?: number;
    }[];
  };
};

/** Revenue history does not require every cost and profit subtotal to be available. */
export type BusinessPeriod = Omit<FinancialPeriod, "metrics"> & {
  metrics: Pick<FinancialMetrics, "revenue"> & Partial<FinancialMetrics>;
};

/** A reconciled flow can omit the gross-profit or operating-profit stage when the filing does. */
export type FlowStatementPeriod = Omit<FinancialPeriod, "metrics"> & {
  metrics: Pick<FinancialMetrics, "revenue" | "pretaxIncome" | "incomeTax" | "netIncome"> &
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
