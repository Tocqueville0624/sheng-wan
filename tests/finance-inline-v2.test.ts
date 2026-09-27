import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichInlinePeriods } from "../scripts/finance/inline-v2";
import type { SecFiling } from "../scripts/finance/sec-shared";
import type { CatalogCompany, PeriodV2 } from "../src/features/finance/v2-types";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import { flowPeriod } from "../scripts/finance/v2-model";

const html = readFileSync(
  new URL("./fixtures/finance/mcd-2026-q2-inline.html", import.meta.url),
  "utf8"
);
const identity: CatalogCompany = {
  ticker: "MCD",
  name: "McDonald's Corporation",
  cik: "0000063908",
  sector: "Consumer Discretionary",
  universe: "sp500"
};
const directoryUrl = "https://www.sec.gov/Archives/edgar/data/63908/000006390826000073/";
const filing: SecFiling = {
  accession: "0000063908-26-000073",
  filedAt: "2026-08-07",
  reportDate: "2026-06-30",
  form: "10-Q",
  primaryDocument: "mcd-20260630.htm",
  directoryUrl,
  sourceUrl: `${directoryUrl}mcd-20260630.htm`
};

function period(): PeriodV2 {
  const p: PeriodV2 = {
    id: "FY2026-Q2",
    label: "FY2026 Q2",
    kind: "quarterly",
    fiscalYear: 2026,
    fiscalQuarter: 2,
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    filedAt: filing.filedAt,
    accession: filing.accession,
    sourceUrl: filing.sourceUrl,
    reportingCurrency: "USD",
    displayCurrency: "USD",
    derived: false,
    metrics: {
      revenue: 7099000000,
      costOfRevenue: 680000000,
      operatingIncome: 3338000000,
      incomeTax: 574000000,
      netIncome: 2362000000
    },
    metricSources: {},
    coverage: { basics: true, segments: false, sankey: false }
  };
  const tags = {
    revenue: "us-gaap:Revenues",
    costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
    operatingIncome: "us-gaap:OperatingIncomeLoss",
    incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
    netIncome: "us-gaap:NetIncomeLoss"
  } as const;
  for (const key of Object.keys(tags) as (keyof typeof tags)[])
    p.metricSources[key] = {
      label: key,
      tag: tags[key],
      accession: filing.accession,
      filedAt: filing.filedAt,
      sourceUrl: filing.sourceUrl,
      method: "reported"
    };
  return p;
}

function fact(tag: string, amount: string, decimals = "-6") {
  return `<ix:nonFraction name="${tag}" contextRef="c-4" unitRef="usd" decimals="${decimals}" scale="6">${amount}</ix:nonFraction>`;
}

describe("same-filing consolidated inline enrichment", () => {
  it("builds the real MCD Q2 direct flow without inventing gross profit or total costs", () => {
    const old = period();
    const before = structuredClone(old);
    const [next] = enrichInlinePeriods(html, identity, filing, [old]);
    expect(old).toEqual(before);
    expect(next.metrics).toMatchObject({
      ...old.metrics,
      totalOperatingCosts: 3760000000,
      pretaxIncome: 2936000000
    });
    expect(next.metrics.grossProfit).toBeUndefined();
    expect(next.metrics.operatingExpenses).toBeUndefined();
    expect(next.metricSources.totalOperatingCosts).toMatchObject({
      tag: "us-gaap:CostsAndExpenses",
      method: "reported",
      decimals: -6
    });
    expect(next.metricSources.pretaxIncome).toMatchObject({
      tag: "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
      accession: filing.accession,
      sourceUrl: filing.sourceUrl,
      method: "reported"
    });
    expect(next.metricSources.revenue).toMatchObject(old.metricSources.revenue!);
    expect(next.metricSources.operatingIncome?.decimals).toBe(-5);
    expect(next.operatingReconciliation).toEqual({
      label: "Source rounding",
      amount: -1000000,
      sourceUrl: filing.sourceUrl
    });
    expect(next.coverage.sankey).toBe(true);
    const flow = buildStatementFlow(flowPeriod(next)!);
    expect(flow.ok).toBe(true);
    if (flow.ok) {
      expect(flow.graph.nodes.some((node) => /gross/i.test(node.label))).toBe(false);
      expect(flow.graph.nodes.some((node) => node.label === "Total operating costs")).toBe(true);
    }
    expect(enrichInlinePeriods(html, identity, filing, [next])).toEqual([]);
  });

  it("accepts an exact direct statement independently of source rounding", () => {
    // Synthetic variant of the real fragment tests the zero-difference branch.
    const exact = html.replaceAll("3,760", "3,761");
    const [next] = enrichInlinePeriods(exact, identity, filing, [period()]);
    expect(next.metrics.totalOperatingCosts).toBe(3761000000);
    expect(next.operatingReconciliation).toBeUndefined();
    expect(next.coverage.sankey).toBe(true);
  });

  it("does not turn an unsupported custom pretax concept into an estimate", () => {
    const unknown = html.replaceAll(
      "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
      "mcd:UnreviewedPretaxConcept"
    );
    expect(enrichInlinePeriods(unknown, identity, filing, [period()])).toEqual([]);
  });

  it("limits the McDonald's custom concept to its verified CIK", () => {
    const otherIdentity = { ...identity, cik: "0000000001" };
    const otherFiling = {
      ...filing,
      sourceUrl: filing.sourceUrl.replace("/63908/", "/1/")
    };
    const otherPeriod = period();
    otherPeriod.sourceUrl = otherFiling.sourceUrl;
    for (const source of Object.values(otherPeriod.metricSources))
      source.sourceUrl = otherFiling.sourceUrl;
    expect(
      enrichInlinePeriods(html.replaceAll("0000063908", "0000000001"), otherIdentity, otherFiling, [
        otherPeriod
      ])
    ).toEqual([]);
  });

  it("can use a standard-taxonomy pretax concept without a company-specific adapter", () => {
    const standard = html.replaceAll(
      "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
    );
    expect(enrichInlinePeriods(standard, identity, filing, [period()])[0].coverage.sankey).toBe(
      true
    );
  });

  it("does not mistake a financial firm's fee revenue for its missing consolidated revenue", () => {
    const contractTag = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
    const contract = html.replaceAll("us-gaap:Revenues", contractTag);
    const financial = { ...identity, sector: "Financials" };
    const old = period();
    delete old.metrics.revenue;
    delete old.metricSources.revenue;
    expect(enrichInlinePeriods(contract, financial, filing, [old])).toEqual([]);
    // A previously selected and independently checked services-company revenue
    // retains its exact concept, including Visa-style customer-contract revenue.
    const present = period();
    present.metricSources.revenue!.tag = contractTag;
    expect(enrichInlinePeriods(contract, financial, filing, [present])[0].coverage.sankey).toBe(
      true
    );
  });

  it("rejects a filing with a different CIK or source path", () => {
    expect(() =>
      enrichInlinePeriods(html.replaceAll("0000063908", "0000000001"), identity, filing, [period()])
    ).toThrow(/CIK/);
    expect(() =>
      enrichInlinePeriods(
        html,
        identity,
        { ...filing, sourceUrl: filing.sourceUrl.replace("/63908/", "/1/") },
        [period()]
      )
    ).toThrow(/issuer/);
  });

  it.each(["dimensions", "typed"])("excludes %s contexts from consolidated metrics", (kind) => {
    const segment =
      kind === "dimensions"
        ? '<xbrli:segment><xbrldi:explicitMember dimension="mcd:BusinessAxis">mcd:FranchiseMember</xbrldi:explicitMember></xbrli:segment>'
        : '<xbrli:segment><xbrldi:typedMember dimension="mcd:BusinessAxis"><mcd:Business>Franchise</mcd:Business></xbrldi:typedMember></xbrli:segment>';
    const scoped = html.replace("</xbrli:entity>", `${segment}</xbrli:entity>`);
    expect(enrichInlinePeriods(scoped, identity, filing, [period()])).toEqual([]);
  });

  it.each(["accession", "date", "currency", "source", "derived"])(
    "does not mix an incompatible %s",
    (kind) => {
      const old = period();
      if (kind === "accession") old.accession = "0000063908-26-000035";
      if (kind === "date") old.startDate = "2026-01-01";
      if (kind === "currency") old.displayCurrency = old.reportingCurrency = "TWD";
      if (kind === "source") old.metricSources.revenue!.accession = "0000063908-26-000035";
      if (kind === "derived") old.metricSources.netIncome!.method = "calculated";
      expect(enrichInlinePeriods(html, identity, filing, [old])).toEqual([]);
    }
  );

  it("rejects disagreeing copies at the highest precision", () => {
    const conflicting = html + fact("us-gaap:CostsAndExpenses", "3,759");
    expect(enrichInlinePeriods(conflicting, identity, filing, [period()])).toEqual([]);
  });

  it("rejects a lower-precision copy when it is outside the reported precision bounds", () => {
    const conflicting = html + fact("us-gaap:CostsAndExpenses", "3,000", "-7");
    expect(enrichInlinePeriods(conflicting, identity, filing, [period()])).toEqual([]);
  });

  it("does not replace an existing reported metric with a different inline amount", () => {
    const old = period();
    old.metrics.revenue = 7100000000;
    expect(enrichInlinePeriods(html, identity, filing, [old])).toEqual([]);
    expect(old.metrics.revenue).toBe(7100000000);
  });

  it.each(["missing", "too precise", "large gap"])(
    "withholds an unsupported rounding adjustment: %s",
    (kind) => {
      let changed = html;
      if (kind === "missing") changed = changed.replaceAll(/ decimals="-\d+"/g, "");
      if (kind === "too precise") changed = changed.replaceAll(/decimals="-\d+"/g, 'decimals="0"');
      if (kind === "large gap") changed = changed.replaceAll("3,760", "3,750");
      expect(enrichInlinePeriods(changed, identity, filing, [period()])).toEqual([]);
    }
  );

  it("rejects a mismatched tax/net-income scope even when the operating identity reconciles", () => {
    const changed = html.replaceAll("2,362", "2,300");
    const old = period();
    old.metrics.netIncome = 2300000000;
    expect(enrichInlinePeriods(changed, identity, filing, [old])).toEqual([]);
  });

  it("preserves reviewed segment statements and does not synthesize a Q4 from another accession", () => {
    const reviewed = period();
    reviewed.coverage.segments = true;
    const q4 = { ...period(), startDate: "2025-10-01", endDate: "2025-12-31" };
    expect(enrichInlinePeriods(html, identity, filing, [reviewed, q4])).toEqual([]);
  });
});
