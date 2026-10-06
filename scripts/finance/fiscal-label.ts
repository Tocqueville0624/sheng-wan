import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { SecFiling } from "./sec-shared";

/** A finite correction for an immutable, individually reviewed original filing.
 * Its cover and primary income-statement columns explicitly report 2022; its
 * dei:DocumentFiscalYearFocus and SEC Company Facts incorrectly say 2021.
 * This changes labels only, never dates, amounts, accessions or metric sources.
 * Other issuers, filings and fiscal calendars retain their declared metadata.
 */
export function reviewedFiscalYear(identity: CatalogCompany, filing: SecFiling, year: number) {
  return identity.cik === "0000915913" &&
    filing.accession === "0000915913-23-000039" &&
    filing.form === "10-K" &&
    filing.reportDate === "2022-12-31" &&
    filing.sourceUrl ===
      "https://www.sec.gov/Archives/edgar/data/915913/000091591323000039/alb-20221231.htm" &&
    year === 2021
    ? 2022
    : year;
}

export const albemarleFiscalLabelNote =
  "The 2022 Albemarle fiscal-year label follows the original filing's December 31, 2022 cover and primary statement columns. That filing's fiscal-year metadata says 2021. Dates, reported amounts and financial sources are unchanged. Source: https://www.sec.gov/Archives/edgar/data/915913/000091591323000039/alb-20221231.htm";

/** Repair an existing label only for the two inspected original sources that
 * produced this historical conflict. Preserve every monetary and source field.
 * This prevents the mislabeled 2022 record from hiding the actual 2021 record
 * when a fresh history arrives; other labels and calendars are untouched. */
export function normalizeReviewedFiscalLabel(cik: string, p: PeriodV2): PeriodV2 {
  const sources = [
    "https://www.sec.gov/Archives/edgar/data/915913/000091591323000039/alb-20221231.htm",
    "https://www.sec.gov/Archives/edgar/data/915913/000091591325000026/alb-20241231.htm"
  ];
  if (
    cik !== "0000915913" ||
    p.kind !== "annual" ||
    p.id !== "FY2021" ||
    p.fiscalYear !== 2021 ||
    p.startDate !== "2022-01-01" ||
    p.endDate !== "2022-12-31" ||
    !sources.includes(p.sourceUrl) ||
    !p.accession ||
    !p.sourceUrl.includes(`/${p.accession.replaceAll("-", "")}/`)
  )
    return p;
  return { ...p, id: "FY2022", label: "FY 2022", fiscalYear: 2022 };
}
