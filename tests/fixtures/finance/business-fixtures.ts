import { readFileSync } from "node:fs";
import { extractFactsV2, type FactsDocument } from "../../../scripts/finance/facts-v2";
import { enrichInlinePeriods } from "../../../scripts/finance/inline-v2";
import { enrichBusinessPeriods } from "../../../scripts/finance/business-v2";
import { parseInlineXbrl } from "../../../scripts/finance/ixbrl";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";

const issuers = {
  MCD: {
    name: "McDonald's Corporation",
    cik: "0000063908",
    accession: "0000063908-26-000073",
    filedAt: "2026-08-07"
  },
  TSLA: {
    name: "Tesla, Inc.",
    cik: "0001318605",
    accession: "0001628280-26-049270",
    filedAt: "2026-07-23"
  },
  IBM: {
    name: "International Business Machines Corporation",
    cik: "0000051143",
    accession: "0000051143-26-000078",
    filedAt: "2026-07-23"
  }
} as const;

/** Test-only Company Facts envelope populated exclusively from preserved SEC facts. */
export function businessFixture(ticker: keyof typeof issuers) {
  const issuer = issuers[ticker];
  const identity: CatalogCompany = {
    ticker,
    name: issuer.name,
    cik: issuer.cik,
    sector: ticker === "IBM" ? "Information Technology" : "Consumer Discretionary",
    universe: "sp500"
  };
  const directoryUrl = `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${issuer.accession.replaceAll("-", "")}/`;
  const filing: SecFiling = {
    accession: issuer.accession,
    filedAt: issuer.filedAt,
    reportDate: "2026-06-30",
    form: "10-Q",
    primaryDocument: `${ticker.toLowerCase()}-20260630.htm`,
    directoryUrl,
    sourceUrl: `${directoryUrl}${ticker.toLowerCase()}-20260630.htm`
  };
  const html = readFileSync(
    new URL(`./${ticker.toLowerCase()}-2026-q2-business.html`, import.meta.url),
    "utf8"
  );
  const parsed = parseInlineXbrl(html);
  const facts: FactsDocument = {
    cik: Number(issuer.cik),
    entityName: issuer.name,
    facts: { "us-gaap": {} }
  };
  const selected = new Map<string, (typeof parsed.facts)[number]>();
  for (const fact of parsed.facts) {
    if (
      fact.context.start !== "2026-04-01" ||
      fact.context.end !== "2026-06-30" ||
      fact.context.typed ||
      Object.keys(fact.context.dimensions).length ||
      fact.currency !== "USD" ||
      !fact.tag.startsWith("us-gaap:")
    )
      continue;
    const old = selected.get(fact.tag);
    if (!old || fact.decimals > old.decimals) selected.set(fact.tag, fact);
  }
  for (const [tag, fact] of selected)
    facts.facts["us-gaap"][tag.slice(8)] = {
      label: tag,
      units: {
        USD: [
          {
            start: fact.context.start,
            end: fact.context.end!,
            val: fact.value,
            accn: issuer.accession,
            fy: 2026,
            fp: "Q2",
            form: "10-Q",
            filed: issuer.filedAt
          }
        ]
      }
    };
  const company = extractFactsV2(facts, identity, [filing]);
  const basic = company.quarterly.find((period) => period.endDate === "2026-06-30")!;
  if (!basic) throw new Error(`No source-derived ${ticker} quarter in fixture`);
  const consolidated = enrichInlinePeriods(html, identity, filing, [basic], parsed)[0] ?? basic;
  const period =
    enrichBusinessPeriods(html, identity, filing, [consolidated], parsed)[0] ?? consolidated;
  company.quarterly = [period];
  return { identity, filing, html, basic, consolidated, period, company };
}
