import { describe, expect, it } from "vitest";
import catalogData from "../src/data/generated/finance-catalog.json";
import type { FinanceCatalog } from "../src/features/finance/v2-types";
import { corpusAcceptance, corpusFilings, uniqueIssuers } from "../scripts/finance/corpus-model";
import { parseFilings } from "../scripts/finance/sec-shared";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

describe("full-catalog SEC corpus inventory", () => {
  it("keeps stale, incomplete, or unavailable current source coverage open", () => {
    const f = reviewedFixture("JNJ");
    expect(corpusAcceptance(f.company, [f.filing], "downloaded", []).complete).toBe(true);
    expect(corpusAcceptance(f.company, [f.filing], "partial", []).complete).toBe(false);
    expect(
      corpusAcceptance(f.company, [{ ...f.filing, reportDate: "2026-09-27" }], "downloaded", [])
        .complete
    ).toBe(false);
    expect(
      corpusAcceptance(f.company, [f.filing], "downloaded", ["2026-06-28: Unacquired source"])
        .complete
    ).toBe(false);
    const missingBusiness = structuredClone(f.company);
    missingBusiness.quarterly[0].coverage.segments = false;
    expect(corpusAcceptance(missingBusiness, [f.filing], "downloaded", []).complete).toBe(false);
  });
  it("accounts for every security and one record per CIK", () => {
    const catalog = catalogData as FinanceCatalog;
    const issuers = uniqueIssuers(catalog.companies);
    expect(issuers.length).toBe(new Set(catalog.companies.map((c) => c.cik)).size);
    expect(issuers.flatMap((c) => c.tickers).sort()).toEqual(
      catalog.companies.map((c) => c.ticker).sort()
    );
    const alphabet = issuers.find((c) => c.tickers.includes("GOOGL"));
    expect(alphabet?.tickers).toContain("GOOG");
  });
  it("downloads the current filing even before it appears in Company Facts", () => {
    const filings = parseFilings("0000104169", {
      accessionNumber: ["0000104169-26-000154", "0000104169-26-000102", "0000104169-26-000055"],
      filingDate: ["2026-08-28", "2026-05-29", "2026-03-13"],
      reportDate: ["2026-07-31", "2026-04-30", "2026-01-31"],
      form: ["10-Q", "10-Q", "10-K"],
      primaryDocument: ["wmt-20260731.htm", "wmt-20260430.htm", "wmt-20260131.htm"]
    });
    expect(corpusFilings(filings).map((f) => f.reportDate)).toEqual([
      "2026-07-31",
      "2026-04-30",
      "2026-01-31"
    ]);
    expect(corpusFilings(filings, [filings[0]])).toHaveLength(3);
  });
  it("retains the latest amendment for a report date and source accession", () => {
    const filings = parseFilings("0000104169", {
      accessionNumber: ["0000104169-26-000155", "0000104169-26-000154"],
      filingDate: ["2026-08-29", "2026-08-28"],
      reportDate: ["2026-07-31", "2026-07-31"],
      form: ["10-Q/A", "10-Q"],
      primaryDocument: ["wmt-amended.htm", "wmt-20260731.htm"]
    });
    expect(corpusFilings(filings)).toEqual([filings[0]]);
    expect(corpusFilings(filings, [filings[1]])).toHaveLength(2);
  });
});
