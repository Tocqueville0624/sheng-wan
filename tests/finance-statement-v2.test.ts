import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichStatementPeriods } from "../scripts/finance/statement-v2";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { flowPeriod, mergeV2, validateV2 } from "../scripts/finance/v2-model";
import type { SecFiling } from "../scripts/finance/sec-shared";
import { buildStatementFlow, layoutStatementFlow } from "../src/features/finance/chart-model";
import type { FinancialMetrics } from "../src/features/finance/types";
import type { CatalogCompany, CompanyV2, PeriodV2 } from "../src/features/finance/v2-types";
import { businessFixture } from "./fixtures/finance/business-fixtures";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/finance/${name}`, import.meta.url), "utf8");

type Case = {
  identity: CatalogCompany;
  filing: SecFiling;
  startDate: string;
  endDate: string;
  fiscalYear: number;
  metrics: Partial<FinancialMetrics>;
  tags: Partial<Record<keyof FinancialMetrics, string>>;
};

function filing(
  cik: number,
  accession: string,
  document: string,
  filedAt: string,
  reportDate: string
): SecFiling {
  const directoryUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/`;
  return {
    accession,
    filedAt,
    reportDate,
    form: "10-K",
    primaryDocument: document,
    directoryUrl,
    sourceUrl: directoryUrl + document
  };
}

/** A Company Facts-style annual period: standard concepts only, all from one filing. */
function period(c: Case): PeriodV2 {
  return {
    id: `FY${c.fiscalYear}`,
    label: `FY ${c.fiscalYear}`,
    kind: "annual",
    fiscalYear: c.fiscalYear,
    startDate: c.startDate,
    endDate: c.endDate,
    filedAt: c.filing.filedAt,
    accession: c.filing.accession,
    sourceUrl: c.filing.sourceUrl,
    reportingCurrency: "USD",
    displayCurrency: "USD",
    derived: false,
    metrics: { ...c.metrics },
    metricSources: Object.fromEntries(
      Object.entries(c.tags).map(([key, tag]) => [
        key,
        {
          label: key,
          tag: tag!,
          accession: c.filing.accession,
          filedAt: c.filing.filedAt,
          sourceUrl: c.filing.sourceUrl,
          method: "reported" as const
        }
      ])
    ),
    coverage: { basics: true, segments: false, sankey: false }
  };
}

const oracle: Case = {
  identity: {
    ticker: "ORCL",
    name: "Oracle Corporation",
    cik: "0001341439",
    sector: "Information Technology",
    universe: "sp500"
  },
  filing: filing(1341439, "0001193125-26-277521", "orcl-20260531.htm", "2026-06-22", "2026-05-31"),
  startDate: "2025-06-01",
  endDate: "2026-05-31",
  fiscalYear: 2026,
  metrics: {
    revenue: 67357e6,
    totalOperatingCosts: 46751e6,
    operatingIncome: 20606e6,
    incomeTax: 2467e6,
    netIncome: 17087e6,
    researchAndDevelopment: 10272e6
  },
  tags: {
    revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalOperatingCosts: "us-gaap:CostsAndExpenses",
    operatingIncome: "us-gaap:OperatingIncomeLoss",
    incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
    netIncome: "us-gaap:NetIncomeLoss",
    researchAndDevelopment: "us-gaap:ResearchAndDevelopmentExpense"
  }
};
const costco: Case = {
  identity: {
    ticker: "COST",
    name: "Costco",
    cik: "0000909832",
    sector: "Consumer Staples",
    universe: "sp500"
  },
  filing: filing(909832, "0000909832-25-000101", "cost-20250831.htm", "2025-10-08", "2025-08-31"),
  startDate: "2024-09-02",
  endDate: "2025-08-31",
  fiscalYear: 2025,
  metrics: {
    revenue: 275235e6,
    costOfRevenue: 239886e6,
    operatingIncome: 10383e6,
    pretaxIncome: 10818e6,
    incomeTax: 2719e6,
    netIncome: 8099e6,
    sellingGeneralAndAdministrative: 24966e6
  },
  tags: {
    revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
    operatingIncome: "us-gaap:OperatingIncomeLoss",
    pretaxIncome:
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
    netIncome: "us-gaap:NetIncomeLoss",
    sellingGeneralAndAdministrative: "us-gaap:SellingGeneralAndAdministrativeExpense"
  }
};
const visa: Case = {
  identity: {
    ticker: "V",
    name: "Visa Inc.",
    cik: "0001403161",
    sector: "Financials",
    universe: "sp500"
  },
  filing: filing(1403161, "0001403161-25-000089", "v-20250930.htm", "2025-11-06", "2025-09-30"),
  startDate: "2024-10-01",
  endDate: "2025-09-30",
  fiscalYear: 2025,
  metrics: {
    revenue: 40000e6,
    operatingIncome: 23994e6,
    pretaxIncome: 24194e6,
    incomeTax: 4136e6,
    netIncome: 20058e6
  },
  tags: {
    revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    operatingIncome: "us-gaap:OperatingIncomeLoss",
    pretaxIncome:
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
    netIncome: "us-gaap:NetIncomeLoss"
  }
};
const palantir: Case = {
  identity: {
    ticker: "PLTR",
    name: "Palantir Technologies",
    cik: "0001321655",
    sector: "Information Technology",
    universe: "sp500"
  },
  filing: filing(1321655, "0001321655-26-000011", "pltr-20251231.htm", "2026-02-17", "2025-12-31"),
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  fiscalYear: 2025,
  metrics: {
    revenue: 4475446e3,
    costOfRevenue: 789177e3,
    grossProfit: 3686269e3,
    operatingExpenses: 2272254e3,
    operatingIncome: 1414015e3,
    pretaxIncome: 1657368e3,
    incomeTax: 22724e3,
    netIncome: 1625033e3,
    researchAndDevelopment: 557677e3
  },
  tags: {
    revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    costOfRevenue: "us-gaap:CostOfRevenue",
    grossProfit: "us-gaap:GrossProfit",
    operatingExpenses: "us-gaap:OperatingExpenses",
    operatingIncome: "us-gaap:OperatingIncomeLoss",
    pretaxIncome:
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
    netIncome: "us-gaap:NetIncomeLoss",
    researchAndDevelopment: "us-gaap:ResearchAndDevelopmentExpense"
  }
};

const run = (c: Case, html: string, p = period(c)) =>
  enrichStatementPeriods(html, c.identity, c.filing, [p]);

describe("generic primary income-statement rows", () => {
  it("reads Oracle's issuer-extension pretax line and its reported operating-cost partition", () => {
    const [next] = run(oracle, fixture("orcl-2026-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.pretaxIncome).toBe(19554e6);
    expect(next.metricSources.pretaxIncome).toMatchObject({
      label: "Income before income taxes",
      tag: "orcl:IncomeLossFromContinuingOperationsIncludingNoncontrollingInterestBeforeIncomeTaxesExtraordinaryItems",
      method: "reported",
      accession: oracle.filing.accession,
      sourceUrl: oracle.filing.sourceUrl,
      decimals: -6
    });
    // Existing reported values keep their exact source.
    expect(next.metricSources.totalOperatingCosts?.tag).toBe("us-gaap:CostsAndExpenses");
    expect(next.metricSources.totalOperatingCosts?.label).toBe("totalOperatingCosts");
    expect(next.operatingCostDetails?.map((item) => [item.label, item.amount])).toEqual([
      ["Cloud and software", 17597e6],
      ["Hardware", 868e6],
      ["Services", 4556e6],
      ["Sales and marketing", 8331e6],
      ["Research and development", 10272e6],
      ["General and administrative", 1618e6],
      ["Amortization of intangible assets", 1671e6],
      ["Restructuring and other", 1838e6]
    ]);
    expect(next.operatingCostDetails?.[0]).toMatchObject({
      tag: "orcl:CloudAndSoftwareExpenses",
      decimals: -6
    });
    expect(next.operatingReconciliation).toBeUndefined();
    const flow = buildStatementFlow(flowPeriod(next)!);
    expect(flow.ok).toBe(true);
    if (!flow.ok) return;
    const details = flow.graph.nodes.filter((node) => node.group === "detail");
    expect(details).toHaveLength(8);
    expect(
      flow.graph.links
        .filter((link) => link.source === "operating-costs")
        .reduce((sum, link) => sum + link.value, 0)
    ).toBe(46751e6);
    // Revenue lines above the reported total never become costs.
    expect(details.some((node) => /^Cloud$|^Software$/.test(node.label))).toBe(false);
    const layout = layoutStatementFlow(flow.graph);
    expect(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true
    );
  });

  it("uses Costco's listed cost rows only because they exactly partition revenue less operating income", () => {
    const [next] = run(costco, fixture("cost-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.totalOperatingCosts).toBe(264852e6);
    expect(next.metricSources.totalOperatingCosts).toMatchObject({
      method: "calculated",
      label: "Sum of reported operating cost lines",
      tag: "us-gaap:CostOfGoodsAndServicesSold + us-gaap:SellingGeneralAndAdministrativeExpense"
    });
    expect(next.derived).toBe(true);
    expect(next.operatingCostDetails?.map((item) => [item.label, item.amount])).toEqual([
      ["Merchandise costs", 239886e6],
      ["Selling, general and administrative", 24966e6]
    ]);
    // The Company Facts pretax concept agrees with the statement row and is retained.
    expect(next.metricSources.pretaxIncome?.tag).toBe(costco.tags.pretaxIncome);
    expect(next.metrics.grossProfit).toBeUndefined();

    // Without the SG&A row the remaining row is not a complete partition.
    const incomplete = fixture("cost-2025-statement.html").replace(
      /<tr><td>Selling, general[\s\S]*?<\/tr>/,
      ""
    );
    expect(run(costco, incomplete)).toEqual([]);
  });

  it("reads Visa's reported operating-expense total when no gross profit is reported", () => {
    const [next] = run(visa, fixture("v-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.totalOperatingCosts).toBe(16006e6);
    expect(next.metricSources.totalOperatingCosts).toMatchObject({
      tag: "us-gaap:CostsAndExpenses",
      label: "Total operating expenses",
      method: "reported"
    });
    expect(next.operatingCostDetails).toHaveLength(7);
    // Consolidated net income equals the Company Facts value; no minority line is invented.
    expect(next.metrics.noncontrollingInterestIncome).toBeUndefined();
    expect(next.metricSources.netIncome?.tag).toBe("us-gaap:NetIncomeLoss");
  });

  it("adds Palantir's reported noncontrolling interest and exact operating expense lines", () => {
    const [next] = run(palantir, fixture("pltr-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.noncontrollingInterestIncome).toBe(9611e3);
    expect(next.metricSources.noncontrollingInterestIncome).toMatchObject({
      tag: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
      label: "Less: Net income attributable to noncontrolling interests",
      method: "reported"
    });
    expect(next.operatingExpenseDetails?.map((item) => item.label)).toEqual([
      "Sales and marketing",
      "Research and development",
      "General and administrative"
    ]);
    expect(next.operatingCostDetails).toBeUndefined();
    const flow = buildStatementFlow(flowPeriod(next)!);
    expect(flow.ok && flow.graph.nodes.some((node) => node.id === "noncontrolling")).toBe(true);
  });

  it("withholds rows that conflict with existing reported values or break an identity", () => {
    const html = fixture("orcl-2026-statement.html");
    const conflicting = period(oracle);
    conflicting.metrics.pretaxIncome = 19000e6;
    conflicting.metricSources.pretaxIncome = {
      ...conflicting.metricSources.incomeTax!,
      tag: "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
    };
    expect(run(oracle, html, conflicting)).toEqual([]);
    expect(run(oracle, html.replace(">17,087<", ">17,088<"))).toEqual([]);
    // A modified operating total cannot partition revenue less operating income.
    const total = period(oracle);
    delete total.metrics.totalOperatingCosts;
    delete total.metricSources.totalOperatingCosts;
    expect(run(oracle, html.replace(">46,751<", ">46,951<"), total)).toEqual([]);
    // Another period, currency or accession is never read from this table.
    expect(run(oracle, html, { ...period(oracle), startDate: "2024-06-01" })).toEqual([]);
    expect(run(oracle, html, { ...period(oracle), accession: "0001193125-25-000001" })).toEqual([]);
  });

  it("keeps the total but not an inexact breakdown", () => {
    const html = fixture("orcl-2026-statement.html").replace(
      'name="orcl:RestructuringAndOtherExpenses" contextRef',
      'name="orcl:RestructuringAndOtherExpenses" sign="-" contextRef'
    );
    const [next] = run(oracle, html);
    expect(next.coverage.sankey).toBe(true);
    expect(next.operatingCostDetails).toBeUndefined();
  });

  it("independently reproduces the reviewed McDonald's flow from its statement rows", () => {
    // MCD tags its current net-income cell with an equity-statement member and
    // reports pretax income with an issuer concept; the reading must match the
    // separately reviewed inline result exactly.
    const { html, identity, filing, basic, consolidated } = businessFixture("MCD");
    const [next] = enrichStatementPeriods(html, identity, filing, [basic]);
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics).toEqual(consolidated.metrics);
    expect(next.operatingReconciliation).toEqual(consolidated.operatingReconciliation);
    expect(next.metricSources.pretaxIncome).toMatchObject({
      tag: "mcd:IncomeLossFromContinuingOperationsBeforeIncomeTaxes",
      label: "Income before provision for income taxes",
      decimals: -6
    });
    // "Other operating (income) expense, net" is income here, so no partition is drawn.
    expect(next.operatingCostDetails).toBeUndefined();
  });

  it("adds exact Tesla operating expense lines without changing reported metrics", () => {
    const { html, identity, filing, consolidated } = businessFixture("TSLA");
    const [next] = enrichStatementPeriods(html, identity, filing, [consolidated]);
    expect(next.metrics).toEqual(consolidated.metrics);
    expect(next.operatingExpenseDetails?.map((item) => [item.label, item.amount])).toEqual([
      ["Research and development", 2371e6],
      ["Selling, general and administrative", 1982e6]
    ]);
    const flow = buildStatementFlow(flowPeriod(next)!);
    expect(flow.ok && flow.graph.nodes.some((node) => node.id === "other-opex")).toBe(false);
  });

  it("rejects a source from another issuer or archive path", () => {
    expect(() =>
      enrichStatementPeriods(
        fixture("orcl-2026-statement.html"),
        { ...oracle.identity, cik: "0000320193" },
        oracle.filing,
        [period(oracle)]
      )
    ).toThrow(/does not match/);
  });

  it("publishes an enriched generic company through the shared import step", () => {
    const base: CompanyV2 = {
      schemaVersion: 2,
      ticker: "ORCL",
      name: "Oracle Corporation",
      cik: "0001341439",
      accent: "#337d9f",
      reportingCurrency: "USD",
      latestPeriod: "FY 2026",
      dataStatus: "verified",
      version: "test",
      updatedAt: "2026-09-28T00:00:00.000Z",
      annual: [period(oracle)],
      quarterly: [],
      warnings: []
    };
    validateV2(base);
    const changes = readGenericFiling(
      fixture("orcl-2026-statement.html"),
      oracle.identity,
      oracle.filing,
      base
    );
    expect(changes).toHaveLength(1);
    const merged = mergeV2(base, { ...base, annual: changes });
    expect(merged.annual[0].coverage.sankey).toBe(true);
    expect(merged.annual[0].operatingCostDetails).toHaveLength(8);
    expect(() => validateV2(merged)).not.toThrow();
  });
});

describe("generic statement lines beyond operating profit", () => {
  const issuer = (ticker: string, name: string, cik: string, sector = "Information Technology") =>
    ({ ticker, name, cik, sector, universe: "sp500" }) as CatalogCompany;
  const pretaxTag =
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
  const amd: Case = {
    identity: issuer("AMD", "Advanced Micro Devices", "0000002488"),
    filing: filing(2488, "0000002488-26-000018", "amd-20251227.htm", "2026-02-04", "2025-12-27"),
    startDate: "2024-12-29",
    endDate: "2025-12-27",
    fiscalYear: 2025,
    metrics: {
      revenue: 34639e6,
      costOfRevenue: 17487e6,
      grossProfit: 17152e6,
      operatingExpenses: 13458e6,
      operatingIncome: 3694e6,
      pretaxIncome: 4140e6,
      incomeTax: -103e6,
      netIncome: 4335e6
    },
    tags: {
      revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
      grossProfit: "us-gaap:GrossProfit",
      operatingExpenses: "us-gaap:OperatingExpenses",
      operatingIncome: "us-gaap:OperatingIncomeLoss",
      pretaxIncome:
        "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
      netIncome: "us-gaap:NetIncomeLoss"
    }
  };
  const tjx: Case = {
    identity: issuer("TJX", "TJX Companies", "0000109198", "Consumer Discretionary"),
    filing: filing(109198, "0000109198-26-000008", "tjx-20260131.htm", "2026-03-31", "2026-01-31"),
    startDate: "2025-02-02",
    endDate: "2026-01-31",
    fiscalYear: 2026,
    metrics: {
      revenue: 60372e6,
      costOfRevenue: 41679e6,
      pretaxIncome: 7299e6,
      incomeTax: 1805e6,
      netIncome: 5494e6,
      sellingGeneralAndAdministrative: 11515e6
    },
    tags: {
      revenue: "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
      pretaxIncome: pretaxTag,
      incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
      netIncome: "us-gaap:NetIncomeLoss",
      sellingGeneralAndAdministrative: "us-gaap:SellingGeneralAndAdministrativeExpense"
    }
  };
  const jnj: Case = {
    identity: issuer("JNJ", "Johnson & Johnson", "0000200406", "Health Care"),
    filing: filing(200406, "0000200406-26-000016", "jnj-20251228.htm", "2026-02-11", "2025-12-28"),
    startDate: "2024-12-30",
    endDate: "2025-12-28",
    fiscalYear: 2025,
    metrics: {
      revenue: 94193e6,
      costOfRevenue: 30256e6,
      grossProfit: 63937e6,
      pretaxIncome: 32581e6,
      incomeTax: 5777e6,
      netIncome: 26804e6
    },
    tags: {
      revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
      grossProfit: "us-gaap:GrossProfit",
      pretaxIncome: pretaxTag,
      incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
      netIncome: "us-gaap:NetIncomeLoss"
    }
  };
  const accenture: Case = {
    identity: issuer("ACN", "Accenture", "0001467373"),
    filing: filing(1467373, "0001467373-25-000217", "acn-20250831.htm", "2025-10-10", "2025-08-31"),
    startDate: "2024-09-01",
    endDate: "2025-08-31",
    fiscalYear: 2025,
    metrics: {
      revenue: 69672977e3,
      costOfRevenue: 47437576e3,
      totalOperatingCosts: 59447313e3,
      operatingIncome: 10225664e3,
      pretaxIncome: 10270393e3,
      incomeTax: 2437993e3,
      netIncome: 7678433e3
    },
    tags: {
      revenue: "us-gaap:Revenues",
      costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
      totalOperatingCosts: "us-gaap:CostsAndExpenses",
      operatingIncome: "us-gaap:OperatingIncomeLoss",
      pretaxIncome: pretaxTag,
      incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
      netIncome: "us-gaap:NetIncomeLoss"
    }
  };
  const nodeIds = (next: PeriodV2) => {
    const flow = buildStatementFlow(flowPeriod(next)!);
    if (!flow.ok) throw new Error(flow.reason);
    return { flow, ids: flow.graph.nodes.map((node) => node.id) };
  };

  it("walks AMD's after-tax equity income and discontinued operations to net income", () => {
    const [next] = run(amd, fixture("amd-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics).toMatchObject({
      equityMethodIncome: 26e6,
      discontinuedOperationsIncome: 66e6
    });
    expect(next.metricSources.discontinuedOperationsIncome).toMatchObject({
      tag: "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity",
      label: "Income from discontinued operations, net of tax",
      method: "reported"
    });
    // The zero restructuring row counts in the exact sum but is not drawn.
    expect(next.operatingExpenseDetails?.map((item) => item.amount)).toEqual([
      8091e6, 4144e6, 1223e6
    ]);
    const { ids } = nodeIds(next);
    expect(ids).toEqual(expect.arrayContaining(["tax-benefit", "equity", "discontinued"]));
    const layout = layoutStatementFlow(nodeIds(next).flow.graph);
    expect(layout.nodes.every((node) => Number.isFinite(node.y))).toBe(true);
  });

  it("charts TJX without an operating-profit line or estimated gross profit", () => {
    const [next] = run(tjx, fixture("tjx-2026-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.operatingIncome).toBeUndefined();
    expect(next.metrics.grossProfit).toBeUndefined();
    expect(next.metrics.expensesAndOtherItems).toBe(53073e6);
    expect(next.metricSources.expensesAndOtherItems).toMatchObject({
      method: "calculated",
      label: "Revenue less pretax profit"
    });
    // Net interest income makes the listed rows a non-partition: none are drawn.
    expect(next.operatingCostDetails).toBeUndefined();
    const { flow, ids } = nodeIds(next);
    expect(ids).not.toContain("operating");
    expect(ids).not.toContain("gross");
    expect(flow.graph.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "revenue", target: "pretax", value: 7299e6 }),
        expect.objectContaining({ source: "revenue", target: "other-items", value: 53073e6 })
      ])
    );
  });

  it("charts Johnson & Johnson from gross profit to pretax profit and ignores a reported zero", () => {
    const [next] = run(jnj, fixture("jnj-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.expensesAndOtherItems).toBe(31356e6);
    expect(next.metricSources.expensesAndOtherItems?.label).toBe("Gross profit less pretax profit");
    expect(next.metrics.discontinuedOperationsIncome).toBeUndefined();
    const { flow, ids } = nodeIds(next);
    expect(ids).toEqual(expect.arrayContaining(["gross", "cost", "other-items", "pretax"]));
    expect(ids).not.toContain("discontinued");
    expect(flow.graph.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "gross", target: "pretax", value: 32581e6 })
      ])
    );
  });

  it("sums Accenture's two reported noncontrolling-interest lines", () => {
    const [next] = run(accenture, fixture("acn-2025-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.noncontrollingInterestIncome).toBe(153967e3);
    expect(next.metricSources.noncontrollingInterestIncome).toMatchObject({
      method: "calculated",
      tag: "us-gaap:NoncontrollingInterestInNetIncomeLossOtherNoncontrollingInterestsRedeemable + us-gaap:NoncontrollingInterestInNetIncomeLossOtherNoncontrollingInterestsNonredeemable"
    });
    expect(next.operatingCostDetails?.map((item) => item.label)).toEqual([
      "Cost of services",
      "Sales and marketing",
      "General and administrative costs",
      "Business optimization costs"
    ]);
  });

  it("reads IBM's reported expense total and discontinued operations", () => {
    const { html, identity, filing: source, consolidated } = businessFixture("IBM");
    const [next] = enrichStatementPeriods(html, identity, source, [consolidated]);
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics).toMatchObject({
      expensesAndOtherItems: 7428e6,
      discontinuedOperationsIncome: -1e6,
      netIncome: 2165e6
    });
    expect(next.metricSources.expensesAndOtherItems).toMatchObject({
      tag: "ibm:ExpenseAndIncomeOther",
      label: "Total expense and other (income)",
      method: "reported"
    });
    const { ids } = nodeIds(next);
    expect(ids).toEqual(expect.arrayContaining(["gross", "other-items", "discontinued"]));
    expect(ids).not.toContain("operating");
  });

  it("uses Walmart's reported total revenues when Company Facts selected net sales", () => {
    const walmart: Case = {
      identity: issuer("WMT", "Walmart", "0000104169", "Consumer Staples"),
      filing: filing(
        104169,
        "0000104169-26-000055",
        "wmt-20260131.htm",
        "2026-03-13",
        "2026-01-31"
      ),
      startDate: "2025-02-01",
      endDate: "2026-01-31",
      fiscalYear: 2026,
      metrics: {
        revenue: 706413e6,
        costOfRevenue: 535395e6,
        operatingIncome: 29825e6,
        pretaxIncome: 29469e6,
        incomeTax: 7199e6,
        netIncome: 21893e6,
        noncontrollingInterestIncome: 377e6
      },
      tags: {
        revenue: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        costOfRevenue: "us-gaap:CostOfRevenue",
        operatingIncome: "us-gaap:OperatingIncomeLoss",
        pretaxIncome: pretaxTag,
        incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
        netIncome: "us-gaap:NetIncomeLoss",
        noncontrollingInterestIncome: "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest"
      }
    };
    const [next] = run(walmart, fixture("wmt-2026-statement.html"));
    expect(next.coverage.sankey).toBe(true);
    expect(next.metrics.revenue).toBe(713163e6);
    expect(next.metricSources.revenue).toMatchObject({
      tag: "us-gaap:Revenues",
      label: "Total revenues",
      method: "reported"
    });
    expect(next.metrics.totalOperatingCosts).toBe(683338e6);
    expect(next.operatingCostDetails?.map((item) => item.label)).toEqual([
      "Cost of sales",
      "Operating, selling, general and administrative expenses"
    ]);
    // A period whose business breakdown cites net sales keeps that revenue concept.
    const cited = { ...period(walmart), coverage: { basics: true, segments: true, sankey: false } };
    const [kept] = enrichStatementPeriods(
      fixture("wmt-2026-statement.html"),
      walmart.identity,
      walmart.filing,
      [cited]
    );
    expect(kept?.metrics.revenue ?? cited.metrics.revenue).toBe(706413e6);
  });

  it("withholds an after-tax line whose meaning is not reviewed", () => {
    const html = fixture("amd-2025-statement.html").replace(
      "us-gaap:IncomeLossFromEquityMethodInvestments",
      "amd:OtherAfterTaxItem"
    );
    expect(run(amd, html)).toEqual([]);
  });
});
