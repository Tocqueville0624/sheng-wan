import type { OriginalRowTuple, originalCellEncoding } from "./original-cell-tuples";
import type { ServiceRevenueCell, ServiceRevenueRowsProof } from "./types";

export type DardenSourceFocus = {
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  originalFiscalPeriod: string;
  fiscalCalendar: string;
  units: ServiceRevenueRowsProof["units"];
};
export type DardenPrimaryColumns = {
  tableIndex: number;
  title: string;
  headerRows: OriginalRowTuple[];
  revenue: OriginalRowTuple;
  tax: OriginalRowTuple;
};
/** Every original current, comparative and cumulative business revenue region.
 * The explicit Corporate zero is retained, not inferred from a blank cell. */
export type DardenRevenueProof = DardenSourceFocus & {
  ruleId: "dri-original-complete-revenue-v1";
  encoding: typeof originalCellEncoding;
  tables: {
    tableIndex: number;
    sourceSalesRows: number[];
    regions: OriginalRowTuple[][];
  }[];
  primary: DardenPrimaryColumns;
};
/** The monetary tax-benefit annotations occur inside the original line label.
 * They are retained separately from the already-net discontinued income cells. */
export type DardenLabelNotes = {
  rowIndex: number;
  labelColumnIndex: 0;
  originalLabelCell: string;
  originalLabel: string;
  annotations: {
    index: number;
    originalDeclaration: string;
    originalLexical: string;
    originalMonetaryCell: ServiceRevenueCell;
  }[];
};
export type DardenInlineIncomeProof = DardenSourceFocus & {
  ruleId: "dri-original-complete-income-v1";
  encoding: typeof originalCellEncoding;
  tableIndex: number;
  title: string;
  rows: OriginalRowTuple[];
  labelNotes: DardenLabelNotes[];
};
