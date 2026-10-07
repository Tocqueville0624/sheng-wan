import type { OriginalRowTuple, originalCellEncoding } from "./original-cell-tuples";
import type { ServiceRevenueRowsProof } from "./types";

export type AmdSourceFocus = {
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  originalFiscalPeriod: string;
  fiscalCalendar: string;
  units: ServiceRevenueRowsProof["units"];
};
/** Complete original revenue section, including every parent, date band, blank
 * cell and comparative/YTD amount. Disputed member names remain unchanged. */
export type AmdRevenueProof = AmdSourceFocus & {
  ruleId: "amd-original-complete-revenue-v1";
  encoding: typeof originalCellEncoding;
  tableIndex: number;
  rows: OriginalRowTuple[];
  classificationBasis: "original-reported-scopes" | "original-row-captions-corroborated-by-mda";
  independentMda?: { tableIndex: number; rows: OriginalRowTuple[] };
  primary: {
    tableIndex: number;
    title: string;
    headerRows: OriginalRowTuple[];
    revenue: OriginalRowTuple;
    tax: OriginalRowTuple;
  };
};
export type AmdBusinessProfile = {
  id: string;
  rows: { label: string; tag: string; dimensions: Record<string, string> }[];
  parent?: { label: string; children: string[] };
  requiresIndependentMda: boolean;
};

/** Complete primary ledger. A separately indexed pretax metric may include
 * after-tax equity income; both scopes are preserved instead of overwriting it. */
export type AmdInlineIncomeProof = AmdSourceFocus & {
  ruleId: "amd-original-complete-income-v1";
  encoding: typeof originalCellEncoding;
  tableIndex: number;
  title: string;
  rows: OriginalRowTuple[];
};
