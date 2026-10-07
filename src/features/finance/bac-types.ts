import type { ServiceRevenueRowsProof } from "./types";

export type BacRowTuple = [number, [number, number, number, string, number?][]];
export type BacOriginalResources = {
  contexts: [string, string, string, string, string, Record<string, string>][];
  facts: [
    string,
    number,
    number,
    number,
    [string, number, string, string, string, "-" | null, string | null][]
  ][];
};

/** An unchanged original footnote, with the actual resources needed to replay
 * its reported inline declarations. No artificial table cells are generated. */
export type BacOriginalNote = {
  offset: number;
  endOffset: number;
  html: string;
  root: string;
  closingRoot: string;
  contexts: string[];
  units: string[];
  metadata: string[];
};

export type BacRevenueProof = {
  ruleId: "bac-original-complete-revenue-v1";
  encoding: "bac-original-resource-tuples-v1";
  resources: BacOriginalResources;
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  originalFiscalPeriod: string;
  units: ServiceRevenueRowsProof["units"];
  primary: { tableIndex: number; rows: BacRowTuple[] };
  business: { tableIndex: number; rows: BacRowTuple[] }[];
  reconciliation?: { tableIndex: number; rows: BacRowTuple[] };
  originalNotes?: BacOriginalNote[];
};
