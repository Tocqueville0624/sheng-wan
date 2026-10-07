export type JpmRowTuple = [number, [number, number, number, string, number?][]];
export type JpmOriginalResources = {
  contexts: [string, string, string, string, string, Record<string, string>][];
  facts: [
    string,
    number,
    number,
    number,
    [string, number, string, string, string, "-" | null, string | null][]
  ][];
};

import type { ServiceRevenueRowsProof } from "./types";

/** Complete original primary revenue section and business/Corporate/reconciling
 * matrices. Current, comparative and YTD columns retain their exact source cells. */
export type JpmRevenueProof = {
  ruleId: "jpm-original-complete-net-revenue-v1";
  encoding: "jpm-original-resource-tuples-v1";
  resources: JpmOriginalResources;
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  originalFiscalPeriod: string;
  units: ServiceRevenueRowsProof["units"];
  primary: { tableIndex: number; rows: JpmRowTuple[] };
  business: { tableIndex: number; rows: JpmRowTuple[] }[];
  originalNotes?: {
    offset: number;
    endOffset: number;
    originalHtml: string;
    originalText: string;
  }[];
};
