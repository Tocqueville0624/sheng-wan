import { readFileSync } from "node:fs";
import { extractFactsV2, type FactsDocument } from "../../../scripts/finance/facts-v2";
import { readGenericFiling } from "../../../scripts/finance/generic-import";
import { parseInlineXbrl } from "../../../scripts/finance/ixbrl";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";

const sources = {
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
  }
} as const;

/** Feed preserved SEC fragments through the same parser as public imports.
 * The Company Facts envelope contains only standard nondimensional facts from
 * this source; all financial amounts and business labels come from the filing.
 */
export function reviewedFixture(ticker: keyof typeof sources) {
  const source = sources[ticker];
  const identity: CatalogCompany = {
    ticker,
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
    form: "10-Q"
  };
  const html = readFileSync(
    new URL(`./${ticker.toLowerCase()}-2026-business-statement.html`, import.meta.url),
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
            form: "10-Q",
            filed: source.filedAt,
            fy: source.fiscalYear,
            fp: "Q2"
          }
        ]
      }
    };
  }
  const company = extractFactsV2(facts, identity, [filing]);
  const basic = company.quarterly.find(
    (p) => p.startDate === source.startDate && p.endDate === source.endDate
  );
  if (!basic) throw new Error(`No source-derived ${ticker} fixture period.`);
  const period =
    readGenericFiling(html, identity, filing, company).find((p) => p.id === basic.id) ?? basic;
  company.quarterly = [period];
  return { identity, filing, html, basic, period, company };
}
