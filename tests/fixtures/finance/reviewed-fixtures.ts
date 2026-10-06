import { readFileSync } from "node:fs";
import { extractFactsV2, type FactsDocument } from "../../../scripts/finance/facts-v2";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { parseInlineXbrl } from "../../../scripts/finance/ixbrl";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";

const sources = {
  INTCSigned: {
    ticker: "INTC",
    fixture: "intc-2026-q2-signed-statement.html",
    name: "Intel",
    cik: "0000050863",
    accession: "0000050863-26-000157",
    filedAt: "2026-07-24",
    startDate: "2026-03-29",
    endDate: "2026-06-27",
    fiscalYear: 2026,
    sector: "Information Technology",
    document: "intc-20260627.htm"
  },
  BDXSigned: {
    ticker: "BDX",
    fixture: "bdx-2026-q2-signed-statement.html",
    name: "Becton Dickinson",
    cik: "0000010795",
    accession: "0000010795-26-000026",
    filedAt: "2026-05-07",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    fiscalYear: 2026,
    sector: "Health Care",
    document: "bdx-20260331.htm"
  },
  FSigned: {
    ticker: "F",
    fixture: "f-2026-q2-signed-statement.html",
    name: "Ford Motor",
    cik: "0000037996",
    accession: "0000037996-26-000156",
    filedAt: "2026-07-29",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Consumer Discretionary",
    document: "f-20260630.htm"
  },
  HPESigned: {
    ticker: "HPE",
    kind: "annual",
    fixture: "hpe-2025-signed-statement.html",
    name: "Hewlett Packard Enterprise",
    cik: "0001645590",
    accession: "0001645590-25-000130",
    filedAt: "2025-12-18",
    startDate: "2024-11-01",
    endDate: "2025-10-31",
    fiscalYear: 2025,
    sector: "Information Technology",
    document: "hpe-20251031.htm"
  },
  MRNASigned: {
    ticker: "MRNA",
    kind: "annual",
    fixture: "mrna-2025-signed-statement.html",
    name: "Moderna",
    cik: "0001682852",
    accession: "0001682852-26-000033",
    filedAt: "2026-02-20",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    fiscalYear: 2025,
    sector: "Health Care",
    document: "mrna-20251231.htm"
  },
  AXONSigned: {
    ticker: "AXON",
    kind: "annual",
    fixture: "axon-2025-signed-statement.html",
    name: "Axon Enterprise",
    cik: "0001069183",
    accession: "0001628280-26-011360",
    filedAt: "2026-02-25",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    fiscalYear: 2025,
    sector: "Industrials",
    document: "axon-20251231.htm"
  },
  CMCSAPrecision: {
    ticker: "CMCSA",
    fixture: "cmcsa-2026-q2-precision-statement.html",
    name: "Comcast",
    cik: "0001166691",
    accession: "0001628280-26-049360",
    filedAt: "2026-07-23",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    reportDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Communication Services",
    document: "cmcsa-20260630.htm"
  },
  GEHC2024Q2: {
    ticker: "GEHC",
    fixture: "gehc-2024-q2-business-statement.html",
    name: "GE HealthCare",
    cik: "0001932393",
    accession: "0001932393-25-000049",
    filedAt: "2025-07-30",
    startDate: "2024-04-01",
    endDate: "2024-06-30",
    reportDate: "2025-06-30",
    fiscalYear: 2024,
    sector: "Health Care",
    document: "gehc-20250630.htm"
  },
  GEHC2024Q3: {
    ticker: "GEHC",
    fixture: "gehc-2024-q3-business-statement.html",
    name: "GE HealthCare",
    cik: "0001932393",
    accession: "0001932393-25-000053",
    filedAt: "2025-10-29",
    startDate: "2024-07-01",
    endDate: "2024-09-30",
    reportDate: "2025-09-30",
    fiscalYear: 2024,
    sector: "Health Care",
    document: "gehc-20250930.htm"
  },
  GEHC2025Q1: {
    ticker: "GEHC",
    fixture: "gehc-2025-q1-business-statement.html",
    name: "GE HealthCare",
    cik: "0001932393",
    accession: "0001932393-26-000031",
    filedAt: "2026-04-29",
    startDate: "2025-01-01",
    endDate: "2025-03-31",
    reportDate: "2026-03-31",
    fiscalYear: 2025,
    sector: "Health Care",
    document: "gehc-20260331.htm"
  },
  GEHC2026Q2: {
    ticker: "GEHC",
    fixture: "gehc-2026-q2-business-statement.html",
    name: "GE HealthCare",
    cik: "0001932393",
    accession: "0001932393-26-000046",
    filedAt: "2026-07-29",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    reportDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Health Care",
    document: "gehc-20260630.htm"
  },
  KO: {
    name: "Coca-Cola",
    cik: "0000021344",
    accession: "0001628280-26-050503",
    filedAt: "2026-07-29",
    startDate: "2026-04-04",
    endDate: "2026-07-03",
    fiscalYear: 2026,
    sector: "Consumer Staples",
    document: "ko-20260703.htm"
  },
  GRMN: {
    name: "Garmin",
    cik: "0001121788",
    accession: "0001193125-26-322114",
    filedAt: "2026-07-29",
    startDate: "2026-03-29",
    endDate: "2026-06-27",
    fiscalYear: 2026,
    sector: "Consumer Discretionary",
    document: "grmn-20260627.htm"
  },
  LII: {
    name: "Lennox International",
    cik: "0001069202",
    accession: "0001069202-26-000087",
    filedAt: "2026-07-29",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "lii-20260630.htm"
  },
  MAS: {
    name: "Masco",
    cik: "0000062996",
    accession: "0000062996-26-000027",
    filedAt: "2026-07-29",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "mas-20260630.htm"
  },
  VLTO: {
    name: "Veralto",
    cik: "0001967680",
    accession: "0001967680-26-000044",
    filedAt: "2026-07-29",
    startDate: "2026-04-04",
    endDate: "2026-07-03",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "vlto-20260703.htm"
  },
  ABT: {
    name: "Abbott",
    cik: "0000001800",
    accession: "0001628280-26-050134",
    filedAt: "2026-07-28",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Health Care",
    document: "abt-20260630.htm"
  },
  ABTAnnual: {
    ticker: "ABT",
    kind: "annual",
    fixture: "abt-2025-business-statement.html",
    name: "Abbott",
    cik: "0000001800",
    accession: "0001628280-26-010185",
    filedAt: "2026-02-20",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    fiscalYear: 2025,
    sector: "Health Care",
    document: "abt-20251231.htm"
  },
  MMM: {
    name: "3M",
    cik: "0000066740",
    accession: "0000066740-26-000246",
    filedAt: "2026-07-21",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    fiscalYear: 2026,
    sector: "Industrials",
    document: "mmm-20260630.htm"
  },
  MMMAnnual: {
    ticker: "MMM",
    kind: "annual",
    fixture: "mmm-2025-business-statement.html",
    name: "3M",
    cik: "0000066740",
    accession: "0000066740-26-000014",
    filedAt: "2026-02-03",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    fiscalYear: 2025,
    sector: "Industrials",
    document: "mmm-20251231.htm"
  },
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
    reportDate: "reportDate" in source ? source.reportDate : source.endDate,
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
      ((f.context.start !== source.startDate || f.context.end !== source.endDate) &&
        !("reportDate" in source && f.context.end === source.reportDate)) ||
      f.context.typed ||
      Object.keys(f.context.dimensions).length ||
      f.currency !== "USD" ||
      !f.tag.startsWith("us-gaap:")
    )
      continue;
    const entry = {
      start: f.context.start!,
      end: f.context.end!,
      val: f.value,
      accn: source.accession,
      form,
      filed: source.filedAt,
      fy: "reportDate" in source ? parsed.fiscalYear : source.fiscalYear,
      fp:
        "reportDate" in source
          ? parsed.fiscalPeriod
          : kind === "annual"
            ? "FY"
            : ticker === "APD" || ticker === "AMAT"
              ? "Q3"
              : "Q2"
    };
    const prior =
      "reportDate" in source ? (facts.facts["us-gaap"][f.tag.slice(8)]?.units.USD ?? []) : [];
    facts.facts["us-gaap"][f.tag.slice(8)] = {
      label: f.tag,
      units: {
        USD: [...prior, entry]
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
