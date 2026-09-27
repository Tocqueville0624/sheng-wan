import { describe, expect, it } from "vitest";
import source from "./fixtures/finance/tsla-2026-q2-facts.json";
import { extractFactsV2, parseFactsDocument } from "../scripts/finance/facts-v2";
import { flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { CatalogCompany } from "../src/features/finance/v2-types";
import type { SecFiling } from "../scripts/finance/sec-shared";

const identity: CatalogCompany = {
  ticker: "TSLA",
  name: "Tesla, Inc.",
  cik: "0001318605",
  sector: "Consumer Discretionary",
  universe: "sp500"
};
const directoryUrl = "https://www.sec.gov/Archives/edgar/data/1318605/000162828026049270/";
const filing: SecFiling = {
  accession: "0001628280-26-049270",
  filedAt: "2026-07-23",
  reportDate: "2026-06-30",
  form: "10-Q",
  primaryDocument: "tsla-20260630.htm",
  sourceUrl: `${directoryUrl}tsla-20260630.htm`,
  directoryUrl
};

describe("Tesla reported noncontrolling-interest scope", () => {
  it("preserves parent profit and its reported attribution when enabling the profit flow", () => {
    const facts = parseFactsDocument(JSON.stringify(source));
    const company = extractFactsV2(facts, identity, [filing]);
    const period = company.quarterly[0];
    expect(period.metrics.netIncome).toBe(1114000000);
    expect(period.metrics.noncontrollingInterestIncome).toBe(14000000);
    expect(period.metrics.pretaxIncome).toBe(1329000000);
    expect(period.metrics.incomeTax).toBe(201000000);
    expect(period.metricSources.netIncome?.tag).toBe("us-gaap:NetIncomeLoss");
    expect(period.metricSources.noncontrollingInterestIncome).toMatchObject({
      tag: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
      method: "reported",
      accession: filing.accession,
      filedAt: filing.filedAt,
      sourceUrl: filing.sourceUrl
    });
    const total = source.facts["us-gaap"].ProfitLoss.units.USD[0].val;
    expect(period.metrics.netIncome! + period.metrics.noncontrollingInterestIncome!).toBe(total);
    expect(period.metrics.pretaxIncome! - period.metrics.incomeTax!).toBe(total);
    expect(period.metrics.netIncome).not.toBe(
      source.facts["us-gaap"].NetIncomeLossAvailableToCommonStockholdersBasic.units.USD[0].val
    );
    expect(period.coverage.sankey).toBe(true);
    expect(() => validateV2(company)).not.toThrow();
    expect(buildStatementFlow(flowPeriod(period)!).ok).toBe(true);
  });

  it("does not invent minority income from the difference when the reported fact is absent", () => {
    const facts = parseFactsDocument(JSON.stringify(source));
    delete facts.facts["us-gaap"].NetIncomeLossAttributableToNoncontrollingInterest;
    const company = extractFactsV2(facts, identity, [filing]);
    const period = company.quarterly[0];
    expect(period.metrics.netIncome).toBe(1114000000);
    expect(period.metrics.noncontrollingInterestIncome).toBeUndefined();
    expect(period.coverage.sankey).toBe(false);
    expect(flowPeriod(period)).toBeUndefined();
  });
});
