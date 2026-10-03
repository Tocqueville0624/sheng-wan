import { readFileSync } from "node:fs";
import { extractFactsV2, type FactsDocument } from "../../../scripts/finance/facts-v2";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { parseInlineXbrl } from "../../../scripts/finance/ixbrl";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";

const sources = {
  AOSAnnual: {
    ticker: "AOS",
    kind: "annual",
    fixture: "aos-2025-business-statement.html",
    name: "A. O. Smith",
    cik: "0000091142",
    accession: "0000091142-26-000008",
    filedAt: "2026-02-10",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    fiscalYear: 2025,
    sector: "Industrials",
    document: "aos-20251231.htm"
  },
  DOV: {
    name: "Dover",
    cik: "0000029905",
    accession: "0000029905-26-000027",
    filedAt: "2026-07-23",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "dov-20260630.htm"
  },
  AOS: {
    name: "A. O. Smith",
    cik: "0000091142",
    accession: "0000091142-26-000098",
    filedAt: "2026-07-30",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "aos-20260630.htm"
  },
  DHR: {
    name: "Danaher",
    cik: "0000313616",
    accession: "0000313616-26-000161",
    filedAt: "2026-07-21",
    startDate: "2026-03-28",
    endDate: "2026-06-26",
    fiscalYear: 2026,
    sector: "Health Care",
    document: "dhr-20260626.htm"
  },
  AMATAnnual: {
    ticker: "AMAT",
    kind: "annual",
    fixture: "amat-2025-business-statement.html",
    name: "Applied Materials",
    cik: "0000006951",
    accession: "0001628280-25-056742",
    filedAt: "2025-12-12",
    startDate: "2024-10-28",
    endDate: "2025-10-26",
    fiscalYear: 2025,
    sector: "Information Technology",
    document: "amat-20251026.htm"
  },
  AMAT: {
    name: "Applied Materials",
    cik: "0000006951",
    accession: "0001628280-26-058235",
    filedAt: "2026-08-20",
    startDate: "2026-04-27",
    endDate: "2026-07-26",
    fiscalYear: 2026,
    sector: "Information Technology",
    document: "amat-20260726.htm"
  },
  WMT: {
    name: "Walmart",
    cik: "0000104169",
    accession: "0000104169-26-000154",
    filedAt: "2026-08-28",
    startDate: "2026-05-01",
    endDate: "2026-07-31",
    fiscalYear: 2027,
    sector: "Consumer Staples",
    document: "wmt-20260731.htm"
  },
  JNJ: {
    name: "Johnson & Johnson",
    cik: "0000200406",
    accession: "0000200406-26-000153",
    filedAt: "2026-07-23",
    startDate: "2026-03-30",
    endDate: "2026-06-28",
    fiscalYear: 2026,
    sector: "Health Care",
    document: "jnj-20260628.htm"
  },
  APD: {
    name: "Air Products and Chemicals",
    cik: "0000002969",
    accession: "0000002969-26-000036",
    filedAt: "2026-07-30",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Materials",
    document: "apd-20260630.htm"
  }
} as const;

/** Feed preserved SEC fragments through the same parser as public imports.
 * The Company Facts envelope contains only standard nondimensional facts from
 * this source; all financial amounts and business labels come from the filing.
 */
export function reviewedFixture(ticker: keyof typeof sources) {
  const source = sources[ticker];
  const kind = "kind" in source ? source.kind : "quarterly";
  const form = kind === "annual" ? "10-K" : "10-Q";
  const identity: CatalogCompany = {
    ticker: "ticker" in source ? source.ticker : ticker,
    name: source.name,
    cik: source.cik,
    sector: source.sector,
    universe: "sp500"
  };
  const directoryUrl = `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${source.accession.replaceAll("-", "")}/`;
  const filing: SecFiling = {
    accession: source.accession,
    filedAt: source.filedAt,
    reportDate: source.endDate,
    primaryDocument: source.document,
    sourceUrl: directoryUrl + source.document,
    directoryUrl,
    form
  };
  const html = readFileSync(
    new URL(
      `./${"fixture" in source ? source.fixture : `${ticker.toLowerCase()}-2026-business-statement.html`}`,
      import.meta.url
    ),
    "utf8"
  );
  const parsed = parseInlineXbrl(html);
  const facts: FactsDocument = {
    cik: Number(source.cik),
    entityName: source.name,
    facts: { "us-gaap": {} }
  };
  for (const f of parsed.facts) {
    if (
      f.context.start !== source.startDate ||
      f.context.end !== source.endDate ||
      f.context.typed ||
      Object.keys(f.context.dimensions).length ||
      f.currency !== "USD" ||
      !f.tag.startsWith("us-gaap:")
    )
      continue;
    facts.facts["us-gaap"][f.tag.slice(8)] = {
      label: f.tag,
      units: {
        USD: [
          {
            start: source.startDate,
            end: source.endDate,
            val: f.value,
            accn: source.accession,
            form,
            filed: source.filedAt,
            fy: source.fiscalYear,
            fp: kind === "annual" ? "FY" : ticker === "APD" || ticker === "AMAT" ? "Q3" : "Q2"
          }
        ]
      }
    };
  }
  const company = extractFactsV2(facts, identity, [filing]);
  const basic = company[kind].find(
    (p) => p.startDate === source.startDate && p.endDate === source.endDate
  );
  if (!basic) throw new Error(`No source-derived ${ticker} fixture period.`);
  const period =
    readGenericFiling(html, identity, filing, company).find((p) => p.id === basic.id) ?? basic;
  company[kind] = [period];
  return { identity, filing, html, basic, period, company };
}
