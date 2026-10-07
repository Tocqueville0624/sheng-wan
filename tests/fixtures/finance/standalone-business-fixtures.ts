import { readFileSync } from "node:fs";
import { parseOriginalStandaloneXbrl } from "../../../scripts/finance/standalone-xbrl";
import { readOriginalStandaloneBusinessFiling } from "../../../scripts/finance/standalone-business-v2";
import { companyFromFilingPeriods } from "../../../scripts/finance/current-filing";
import { extractFactsV2, type FactsDocument } from "../../../scripts/finance/facts-v2";
import type { CatalogCompany } from "../../../src/features/finance/v2-types";
import type { SecFiling } from "../../../scripts/finance/sec-shared";

/** All monetary inputs below are independently decoded from preserved original
 * XML declarations. No chart values, inline tags or financial facts are invented. */
export async function standaloneBusinessFixture(ticker: "AME" | "ALB" | "UNH") {
  if (ticker === "UNH") {
    const source = JSON.parse(
      readFileSync(
        new URL("./unitedhealth-fy2016-original-separate-source.json", import.meta.url),
        "utf8"
      )
    );
    const identity: CatalogCompany = {
      ticker,
      name: "UnitedHealth Group Incorporated",
      cik: source.cik,
      sector: "Health Care",
      universe: "sp500"
    };
    const html = readFileSync(
      new URL("./unitedhealth-fy2016-original-separate-income-business.html", import.meta.url),
      "utf8"
    );
    const xml = readFileSync(
      new URL("./unitedhealth-fy2016-original-separate-financial.xml", import.meta.url),
      "utf8"
    );
    const base = companyFromFilingPeriods(identity, [source.preservedPeriod]);
    const periods = await readOriginalStandaloneBusinessFiling(
      html,
      xml,
      source.sourceInstance.url,
      identity,
      source.filing,
      base
    );
    const period = periods.find((p) => p.id === "FY2016");
    if (!period) throw Error("UnitedHealth original standalone period was withheld");
    return { company: companyFromFilingPeriods(identity, [period]), period };
  }
  const ame = ticker === "AME";
  const identity: CatalogCompany = {
    ticker,
    name: ame ? "AMETEK, Inc." : "Albemarle Corporation",
    cik: ame ? "0001037868" : "0000915913",
    sector: ame ? "Industrials" : "Materials",
    universe: "sp500"
  };
  const accession = ame ? "0001193125-19-046947" : "0000915913-19-000021";
  const directoryUrl = `https://www.sec.gov/Archives/edgar/data/${Number(identity.cik)}/${accession.replaceAll("-", "")}/`;
  const primaryDocument = ame ? "d640432d10k.htm" : "a1231201810-kdocument.htm";
  const filing: SecFiling = {
    accession,
    filedAt: ame ? "2019-02-21" : "2019-02-27",
    reportDate: "2018-12-31",
    form: "10-K",
    primaryDocument,
    directoryUrl,
    sourceUrl: directoryUrl + primaryDocument
  };
  const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  const html = read(`${ticker.toLowerCase()}-fy2016-original-separate-income-business.html`);
  const xml = read(`${ticker.toLowerCase()}-fy2016-original-separate-financial.xml`);
  const parsed = parseOriginalStandaloneXbrl(xml, identity.cik);
  const facts: FactsDocument = {
    cik: Number(identity.cik),
    entityName: identity.name,
    facts: { "us-gaap": {} }
  };
  for (const f of parsed.facts) {
    if (
      Object.keys(f.context.dimensions).length ||
      !f.tag.startsWith("us-gaap:") ||
      f.currency !== "USD" ||
      !f.context.start ||
      !f.context.end
    )
      continue;
    const name = f.tag.slice(8);
    const prior = facts.facts["us-gaap"][name]?.units.USD ?? [];
    facts.facts["us-gaap"][name] = {
      label: f.tag,
      units: {
        USD: [
          ...prior,
          {
            start: f.context.start,
            end: f.context.end,
            val: f.value,
            accn: accession,
            form: filing.form,
            filed: filing.filedAt,
            fy: 2018,
            fp: "FY"
          }
        ]
      }
    };
  }
  const company = extractFactsV2(facts, identity, [filing]);
  const periods = await readOriginalStandaloneBusinessFiling(
    html,
    xml,
    directoryUrl + (ame ? "ame-20181231.xml" : "alb-20181231.xml"),
    identity,
    filing,
    company
  );
  const period = periods.find((p) => p.id === "FY2016");
  if (!period)
    throw Error(
      "Original standalone browser fixture did not produce its source-linked FY2016 period."
    );
  company.annual = [period];
  company.quarterly = [];
  return { company, period };
}

export async function sourceOnlyFixture(ticker: "AME" | "ALB" | "UNH") {
  const preserved = await standaloneBusinessFixture(ticker);
  const p = preserved.period;
  const identity: CatalogCompany = {
    ticker,
    cik: preserved.company.cik,
    name: preserved.company.name,
    sector: "",
    universe: "sp500"
  };
  const url = new URL(p.sourceUrl);
  const filing: SecFiling = {
    accession: p.accession!,
    filedAt: p.filedAt,
    form: "10-K",
    reportDate: "2018-12-31",
    sourceUrl: p.sourceUrl,
    directoryUrl: p.sourceUrl.slice(0, p.sourceUrl.lastIndexOf("/") + 1),
    primaryDocument: url.pathname.split("/").at(-1)!
  };
  const read = (suffix: string) =>
    readFileSync(
      new URL(
        `./${ticker === "UNH" ? "unitedhealth" : ticker.toLowerCase()}-fy2016-original-separate-${suffix}`,
        import.meta.url
      ),
      "utf8"
    );
  return {
    identity,
    filing,
    html: read("income-business.html"),
    xml: read("financial.xml"),
    instanceUrl:
      filing.directoryUrl + `${ticker === "UNH" ? "unh" : ticker.toLowerCase()}-20181231.xml`,
    preserved
  };
}

export async function sourceOnlyBusinessFixture(ticker: "AME" | "ALB" | "UNH") {
  const s = await sourceOnlyFixture(ticker);
  const periods = await readOriginalStandaloneBusinessFiling(
    s.html,
    s.xml,
    s.instanceUrl,
    s.identity,
    s.filing,
    undefined
  );
  const period = periods.find((p) => p.id === "FY2016");
  if (!period) throw Error("Original source-only fixture withheld its annual period.");
  return { company: companyFromFilingPeriods(s.identity, [period]), period };
}
