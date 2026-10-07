import type { MetricSource } from "./v2-types";
import type { OriginalStandaloneBusinessProof } from "./standalone-business";
import type { AlbemarleInlineIncomeProof } from "./albemarle-inline-income";
import type { AlignInlineIncomeProof } from "./align-inline-income";
import type { OriginalStatementCorroboration } from "./statement-corroboration";

export type PeriodKind = "annual" | "quarterly";
export type DataStatus = "verified" | "delayed" | "demo";

export type FinancialMetrics = {
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  totalOperatingCosts?: number;
  /** Reported statement-wide expenses, including interest; not operating costs. */
  totalExpenses?: number;
  operatingIncome: number;
  pretaxIncome: number;
  incomeTax: number;
  netIncome: number;
  researchAndDevelopment?: number;
  sellingGeneralAndAdministrative?: number;
  equityMethodIncome?: number;
  /** Signed after-tax income (loss) from unconsolidated subsidiaries, as reported. */
  afterTaxSubsidiaryIncome?: number;
  /** Signed, separately reported equity-method transaction gain/loss after tax. */
  afterTaxTransactionIncome?: number;
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
  dimensions?: Record<string, string>;
};

/** Complete, source-ordered operating ledger with separately reported gains.
 * Costs are nonnegative; gains retain their original signed income/expense value.
 */
export type OperatingItems = {
  ruleId: string;
  sourceUrl: string;
  accession: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  currency: "USD";
  tableIndex: number;
  revenue: StatementLine & { rowIndex: number };
  operatingIncome: StatementLine & { rowIndex: number };
  costSubtotal?: StatementLine & { rowIndex: number };
  operatingSubtotal?: StatementLine & { rowIndex: number };
  /** A reported segment-NOI expense subtotal incorrectly indexed as a consolidated
   * operating-expense metric. Preserve its exact source outside the main ledger. */
  excludedSegmentExpenses?: {
    tableIndex: number;
    revenue: StatementLine & { rowIndex: number };
    totalExpenses: StatementLine & { rowIndex: number };
    segmentIncome: StatementLine & { rowIndex: number };
    originalMetricSource: MetricSource;
  };
  items: (StatementLine & { effect: "cost" | "gain"; rowIndex: number })[];
};

/** Reviewed primary gross and operating ledgers. Original costs stay separate;
 * a negative signed operating cost is a reported reversal or operating gain. */
export type GrossOperatingItems = {
  /** Original separate XML/HTML proof for reviewed standalone income ledgers. */
  standaloneSource?: OriginalStandaloneBusinessProof;
  /** Original physical inline primary rows, including comparative and YTD scopes. */
  inlineSource?: AlbemarleInlineIncomeProof;
  ruleId: string;
  sourceUrl: string;
  accession: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  currency: "USD";
  tableIndex: number;
  revenue: StatementLine & { rowIndex: number };
  cost: StatementLine & { rowIndex: number };
  grossCosts: (StatementLine & { rowIndex: number })[];
  grossProfit: StatementLine & { rowIndex: number };
  operatingCosts: (StatementLine & { rowIndex: number })[];
  operatingIncome: StatementLine & { rowIndex: number };
};

/** A reviewed primary statement that goes directly from revenue and reported
 * expenses/gains to consolidated net income, without pretax or tax subtotals.
 */
export type DirectNetItems = {
  ruleId: string;
  sourceUrl: string;
  accession: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  currency: "USD";
  tableIndex: number;
  revenue: StatementLine & { rowIndex: number };
  expenses: StatementLine & { rowIndex: number };
  expenseItems: (StatementLine & { effect: "cost" | "gain"; rowIndex: number })[];
  gains: (StatementLine & { rowIndex: number })[];
  consolidated: StatementLine & { rowIndex: number };
  noncontrolling: StatementLine & { rowIndex: number };
  parent: StatementLine & { rowIndex: number };
};

/** Reviewed operating-to-net ledger with no pretax subtotal in the primary
 * statement. Each subsequent gain, expense and tax retains its original scope. */
export type OperatingNetItems = {
  ruleId: string;
  sourceUrl: string;
  accession: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  currency: "USD";
  tableIndex: number;
  revenue: StatementLine & { rowIndex: number };
  costs: (StatementLine & { rowIndex: number })[];
  expenses: StatementLine & { rowIndex: number };
  operatingSubtotal?: StatementLine & { rowIndex: number };
  operatingGains: (StatementLine & { rowIndex: number })[];
  operatingIncome: StatementLine & { rowIndex: number };
  netItems: (StatementLine & { effect: "gain" | "cost"; rowIndex: number })[];
  consolidated: StatementLine & { rowIndex: number };
  noncontrolling: StatementLine & { rowIndex: number };
  parent: StatementLine & { rowIndex: number };
};

/** A reviewed after-tax transaction chain, separate from ordinary equity income.
 * Original rows and signs corroborate both consolidated and parent subtotals. */
export type AfterTaxTransactionItems = {
  ruleId: string;
  sourceUrl: string;
  accession: string;
  filedAt: string;
  startDate: string;
  endDate: string;
  currency: "USD";
  tableIndex: number;
  pretax: StatementLine & { rowIndex: number };
  tax: StatementLine & { rowIndex: number };
  transaction: StatementLine & { rowIndex: number };
  equity: StatementLine & { rowIndex: number };
  consolidated: StatementLine & { rowIndex: number };
  noncontrolling: StatementLine & { rowIndex: number };
  parent: StatementLine & { rowIndex: number };
};

/** Reported allocations after the selected net-income scope, never an expense
 * partition. Signed amounts are deducted from the unchanged base subtotal.
 */
export type ShareholderIncomeBridge = {
  sourceUrl: string;
  accession: string;
  filedAt: string;
  base: {
    label: string;
    tag: string;
    amount: number;
    scope: "parent" | "consolidated";
    decimals?: number;
    /** Independent nondimensional standard fact corroborating this same amount. */
    corroboratingTag?: string;
  };
  common: { label: string; tag: string; amount: number; decimals?: number };
  allocations: {
    id: string;
    label: string;
    tag: string;
    amount: number;
    decimals?: number;
    /** Only a reviewed redemption gain may be added with its original sign. */
    effect?: "gain";
  }[];
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
    /** Explicit arithmetic over original reported product rows, never a reported QName. */
    calculation?: { method: "sum-of-reported-products"; products: string[] };
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

export type ProductPortfolioCell = {
  columnIndex: number;
  span: number;
  label: string;
  facts: {
    tag: string;
    value: number;
    decimals: number;
    contextId: string;
    dimensions: Record<string, string>;
    /** All declarations share this fact's QName/context and the reviewed USD,
     * million-scale, -6 decimal contract; repeated nested IDs remain explicit. */
    declarations: {
      id?: string;
      format: string;
    }[];
  }[];
};

/** Complete original service-revenue rows and their temporal column headers.
 * Comparative cells remain original facts; only one proved period is charted.
 */
export type ServiceRevenueCell = {
  columnIndex: number;
  span: number;
  rowSpan: number;
  label: string;
  fact?: {
    tag: string;
    value: number;
    decimals: number;
    contextId: string;
    cik: string;
    currency: "USD";
    startDate: string;
    endDate: string;
    dimensions: Record<string, string>;
    /** A nested source declaration with the identical QName, amount, dates,
     * currency and precision, but its own original consolidated/aggregate context. */
    corroboratingContexts?: { contextId: string; dimensions: Record<string, string> }[];
    declarations: {
      tag: string;
      contextId: string;
      unitRef: string;
      scale: number;
      /** Original declaration text in addition to the normalized precision. */
      decimals?: string;
      originalScale?: string;
      format: string;
      sign?: "-";
      id?: string;
    }[];
  };
};
export type ServiceRevenueRow = { rowIndex: number; cells: ServiceRevenueCell[] };
export type ServiceRevenueRowsProof = {
  ruleId: string;
  reportDate: string;
  form: string;
  units: { id: string; measure: "iso4217:USD" }[];
  tableIndex: number;
  rows: ServiceRevenueRow[];
  primary: {
    tableIndex: number;
    title: string;
    headerRows: ServiceRevenueRow[];
    revenue: ServiceRevenueRow;
    tax: ServiceRevenueRow;
  };
};
/** Original Albemarle revenue section, including every branch, blank, subtotal,
 * period header and an independent primary statement anchor. */
export type AlbemarleBusinessProof = {
  ruleId: "alb-original-revenue-section-v1";
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  layout: "rows" | "columns";
  units: ServiceRevenueRowsProof["units"];
  tableIndex: number;
  headerRows: ServiceRevenueRow[];
  rows: ServiceRevenueRow[];
  primary: ServiceRevenueRowsProof["primary"];
};
/** Complete original AMETEK EIG/EMG closing row, including temporal headings,
 * original comparative/YTD cells and an independent primary net-sales anchor. */
export type AmetekBusinessProof = {
  ruleId: "ame-original-closing-sales-v1";
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  units: ServiceRevenueRowsProof["units"];
  tableIndex: number;
  headerRows: ServiceRevenueRow[];
  revenue: ServiceRevenueRow;
  primary: ServiceRevenueRowsProof["primary"];
};
/** Complete Church & Dwight product hierarchy and independent primary columns.
 * All comparative and cumulative cells keep their original precision and scope. */
export type ChurchDwightBusinessProof = {
  ruleId: "chd-original-product-hierarchy-v1";
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  units: ServiceRevenueRowsProof["units"];
  tableIndex: number;
  headerRows: ServiceRevenueRow[];
  rows: ServiceRevenueRow[];
  primary: ServiceRevenueRowsProof["primary"];
};
export type ProductPortfolioProof = {
  ruleId: "abbv-original-product-portfolios-v1";
  startDate: string;
  endDate: string;
  reportDate: string;
  form: string;
  tables: {
    tableIndex: number;
    rowCount: number;
    headerRows: number[];
    emptyRows: number[];
    year: { label: string; rowIndex: number; columnIndex: number; span: number };
    temporal: {
      label: string;
      rowIndex: number;
      columnIndex: number;
      span: number;
      rowSpan: number;
      method: "original-spanning-header" | "original-single-Q1-table-caption";
    };
    quarter1ComparisonYears?: { label: string; columnIndex: number; span: number }[];
  }[];
  continuations: { fromTable: number; toTable: number; footerTableIndex: number; label: string }[];
  headings: { label: string; tableIndex: number; rowIndex: number }[];
  products: {
    id: string;
    label: string;
    portfolio?: string;
    rows: {
      tableIndex: number;
      rowIndex: number;
      label: string;
      scope: string;
      cells: ProductPortfolioCell[];
    }[];
  }[];
  total: { tableIndex: number; rowIndex: number; cells: ProductPortfolioCell[] };
  /** Original primary income-statement row, separate from the product section. */
  primary: { tableIndex: number; rowIndex: number; label: string; cell: ProductPortfolioCell };
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
  /** An older complete original report independently reproduces all previously
   * saved reported facts. The prior record and its provenance remain intact. */
  originalStatementCorroboration?: OriginalStatementCorroboration;
  metrics: FinancialMetrics;
  grossProfitAdjustments?: { label: string; amount: number; sourceUrl: string }[];
  /** Signed, declared-precision rounding; all reported amounts remain unchanged. */
  operatingReconciliation?: {
    label: string;
    amount: number;
    sourceUrl: string;
    basis?: "gross-profit";
  };
  afterTaxReconciliation?: { label: string; amount: number; sourceUrl: string };
  shareholderBridge?: ShareholderIncomeBridge;
  operatingItems?: OperatingItems;
  grossOperatingItems?: GrossOperatingItems;
  alignInlineIncome?: AlignInlineIncomeProof;
  directNetItems?: DirectNetItems;
  operatingNetItems?: OperatingNetItems;
  afterTaxTransactionItems?: AfterTaxTransactionItems;
  /** A rounded intermediate subtotal is corroboration, not a replacement for the
   * exact arithmetic leading to the selected final net-income scope.
   */
  consolidatedIncomeSubtotal?: {
    label: string;
    tag: string;
    amount: number;
    decimals: number;
    sourceUrl: string;
  };
  /** Disclosed components whose declared precision prevents an exact expense
   * partition. Keep the independent metrics; do not draw a manufactured remainder.
   */
  roundedOperatingExpenseComponents?: {
    components: StatementLine[];
    difference: number;
    sourceUrl: string;
  };
  segments?: RevenueSegment[];
  revenueAdjustments?: RevenueSegment[];
  operatingExpenseDetails?: StatementLine[];
  /** A calculated net difference of reported gross profit and operating income;
   * cost/gain/equity components are not claimed to be an expense partition.
   */
  operatingExpensesBasis?: "expenses-and-other-items-net";
  /**
   * Reported rows that exactly partition the direct route's cost node: total operating
   * costs, or expenses and other items when no operating-profit line is reported.
   */
  operatingCostDetails?: StatementLine[];
  segmentSourceUrl?: string;
  segmentBasis?: string;
  businessBreakdownSource?: {
    method:
      | "statement-revenue-rows"
      | "statement-revenue-matrix"
      | "reviewed-segment-table"
      | "reported-product-portfolios"
      | "reviewed-service-revenue-rows"
      | "reviewed-albemarle-revenue"
      | "reviewed-ametek-revenue"
      | "reviewed-church-dwight-revenue"
      | "reviewed-original-standalone-revenue";
    standaloneRevenue?: OriginalStandaloneBusinessProof;
    ametekRevenue?: AmetekBusinessProof;
    churchDwightRevenue?: ChurchDwightBusinessProof;
    albemarleRevenue?: AlbemarleBusinessProof;
    productPortfolios?: ProductPortfolioProof;
    serviceRevenueRows?: ServiceRevenueRowsProof;
    originalRevenueRows?: {
      rows: ServiceRevenueRow[];
      units: ServiceRevenueRowsProof["units"];
      /** Independent primary revenue, with its original headers and blanks. */
      primaryRows?: ServiceRevenueRow[];
      /** Unchanged original text immediately preceding the reviewed table. */
      precedingText?: string;
      primaryPrecedingText?: string;
    };
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
    /** Complete source headers for a reviewed external-customer row. Blank
     * columns carry no monetary amount; repeated consolidated totals count once.
     */
    externalCustomerColumns?: {
      headers: { label: string; columnIndex: number; span: number }[];
      totals: {
        label: string;
        tag: string;
        value: number;
        decimals: number;
        dimensions: Record<string, string>;
        columnIndex: number;
      }[];
      blanks: { label: string; columnIndex: number }[];
    };
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

export type DirectNetStatementPeriod = Omit<FinancialPeriod, "metrics" | "directNetItems"> & {
  directNetItems: DirectNetItems;
  metrics: Pick<FinancialMetrics, "revenue" | "netIncome"> & Partial<FinancialMetrics>;
};

export type OperatingNetStatementPeriod = Omit<FinancialPeriod, "metrics" | "operatingNetItems"> & {
  operatingNetItems: OperatingNetItems;
  metrics: Pick<FinancialMetrics, "revenue" | "netIncome" | "operatingIncome" | "incomeTax"> &
    Partial<FinancialMetrics>;
};

export type StatementChartPeriod =
  FlowStatementPeriod | DirectNetStatementPeriod | OperatingNetStatementPeriod;

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
