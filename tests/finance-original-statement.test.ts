import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pairs from "./fixtures/finance/original-statement-source-pairs.json";
import type { CatalogCompany, PeriodV2 } from "../src/features/finance/v2-types";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { genericFilingTodo, readGenericFiling } from "../scripts/finance/generic-import";
import { businessPeriod, flowPeriod, mergeV2, validateV2 } from "../scripts/finance/v2-model";
import { corroborateOriginalStatement } from "../src/features/finance/statement-corroboration";
import type { SecFiling } from "../scripts/finance/sec-shared";

const fixtures = pairs.rows.map((row) => ({
  ...row,
  identity: row.identity as CatalogCompany,
  filing: row.filing as SecFiling,
  prior: row.prior as PeriodV2,
  original: row.original as PeriodV2
}));
const chd = fixtures[0];
const priorCompany = () => companyFromFilingPeriods(chd.identity, [chd.prior]);
const originalCompany = () => companyFromFilingPeriods(chd.identity, [chd.original]);

describe("complete original statements corroborated by all saved reported facts", () => {
  it("reads the original CHD Q1 source through the actual importer, preserves the entire later record and survives both refresh directions", () => {
    const html = readFileSync(
      new URL("./fixtures/finance/chd-2026-q1-original-review.html", import.meta.url),
      "utf8"
    );
    expect(createHash("sha256").update(html).digest("hex")).toBe(chd.originalSource.sha256);
    const prior = priorCompany();
    const periods = readGenericFiling(html, chd.identity, chd.filing, prior, []);
    const p = periods.find((p) => p.id === "2026-Q1")!;
    expect(p.metrics).toMatchObject({
      revenue: 1469300000,
      grossProfit: 681400000,
      operatingIncome: 291000000,
      pretaxIncome: 272600000,
      incomeTax: 56300000,
      netIncome: 216300000
    });
    expect(p.segments!.map((s) => s.revenue)).toEqual([641600000, 476100000, 273900000, 77700000]);
    const result = mergeV2(prior, companyFromFilingPeriods(chd.identity, periods));
    const updated = result.quarterly.find((p) => p.id === chd.prior.id)!;
    expect(updated.originalStatementCorroboration!.prior).toEqual(chd.prior);
    expect(updated.metrics.netIncome).toBe(chd.prior.metrics.netIncome);
    expect(updated.metricSources.netIncome!.sourceUrl).toBe(chd.filing.sourceUrl);
    expect(flowPeriod(updated)).toBeDefined();
    expect(businessPeriod(updated)).toBeDefined();
    validateV2(result);
    expect(mergeV2(result, prior).quarterly[0]).toEqual(updated);
    expect(mergeV2(result, originalCompany()).quarterly[0]).toEqual(updated);
    expect(chd.prior.originalStatementCorroboration).toBeUndefined();
    expect(prior.quarterly[0]).toEqual(chd.prior);
  });

  it.each(fixtures.slice(1, 3))(
    "preserves every known amount and detail in $identity.ticker $prior.id",
    (f) => {
      const proof = corroborateOriginalStatement(f.identity.cik, f.prior, f.original)!;
      expect(proof).toBeDefined();
      expect(proof.prior).toEqual(f.prior);
      for (const key of Object.keys(f.prior.metrics) as (keyof PeriodV2["metrics"])[]) {
        expect(f.original.metrics[key]).toBe(f.prior.metrics[key]);
      }
      const result = mergeV2(
        companyFromFilingPeriods(f.identity, [f.prior]),
        companyFromFilingPeriods(f.identity, [f.original])
      );
      const p = [...result.annual, ...result.quarterly][0];
      expect(p.originalStatementCorroboration!.prior).toEqual(f.prior);
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      if (f.identity.ticker === "EOG")
        expect(p.operatingCostDetails).toEqual(f.prior.operatingCostDetails);
      if (f.identity.ticker === "LEN")
        expect(p.segments!.map((s) => s.revenue)).toEqual([
          25545242000, 898745000, 665232000, 21457000
        ]);
      validateV2(result);
    }
  );

  it("rejects an actual EXPE business reclassification despite exact agreement of all saved consolidated amounts", () => {
    const f = fixtures[3];
    expect(f.original.metrics).toMatchObject(f.prior.metrics);
    expect(f.prior.segments![0].revenue).toBe(8362000000);
    expect(f.original.segments![0].revenue).toBe(8472000000);
    expect(corroborateOriginalStatement(f.identity.cik, f.prior, f.original)).toBeUndefined();
    const merged = mergeV2(
      companyFromFilingPeriods(f.identity, [f.prior]),
      companyFromFilingPeriods(f.identity, [f.original])
    );
    expect(merged.annual[0]).toEqual(f.prior);
  });

  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "amount",
      (p) => {
        p.metrics.netIncome! += 1;
      }
    ],
    [
      "reported concept",
      (p) => {
        p.metricSources.netIncome!.tag = "us-gaap:ProfitLoss";
      }
    ],
    [
      "calculated fact",
      (p) => {
        p.metricSources.netIncome!.method = "calculated";
      }
    ],
    [
      "source binding",
      (p) => {
        p.metricSources.netIncome!.sourceUrl = chd.original.sourceUrl;
      }
    ],
    [
      "missing source",
      (p) => {
        delete p.metricSources.netIncome;
      }
    ],
    [
      "extra source",
      (p) => {
        p.metricSources.revenue = structuredClone(p.metricSources.netIncome!);
      }
    ],
    [
      "fiscal label",
      (p) => {
        p.fiscalYear -= 1;
      }
    ],
    [
      "quarter",
      (p) => {
        p.fiscalQuarter = 2;
      }
    ],
    [
      "date",
      (p) => {
        p.startDate = "2026-01-02";
      }
    ],
    [
      "invalid date",
      (p) => {
        p.endDate = "2026-02-31";
      }
    ],
    [
      "currency",
      (p) => {
        p.displayCurrency = "CAD";
      }
    ],
    [
      "derived statement",
      (p) => {
        p.derived = true;
      }
    ],
    [
      "issuer",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("/313927/", "/1800/");
      }
    ],
    [
      "calculation input",
      (p) => {
        p.metricSources.netIncome!.inputs = ["estimate"];
      }
    ],
    [
      "complete prior",
      (p) => {
        p.coverage.segments = p.coverage.sankey = true;
      }
    ],
    [
      "lost known detail",
      (p) => {
        p.operatingExpensesBasis = "reported" as PeriodV2["operatingExpensesBasis"];
      }
    ],
    [
      "unsupported business metadata",
      (p) => {
        p.segmentSourceUrl = p.sourceUrl;
      }
    ],
    [
      "nested upgrade",
      (p) => {
        p.originalStatementCorroboration = corroborateOriginalStatement(
          chd.identity.cik,
          chd.prior,
          chd.original
        );
      }
    ]
  ];
  it.each(mutations)("withholds changed or unverified prior %s", (_, mutate) => {
    const p = structuredClone(chd.prior);
    mutate(p);
    expect(corroborateOriginalStatement(chd.identity.cik, p, chd.original)).toBeUndefined();
  });

  it("replays both chart contracts and the prior schema instead of trusting coverage flags", () => {
    const proof = corroborateOriginalStatement(chd.identity.cik, chd.prior, chd.original)!;
    const original = structuredClone(chd.original);
    original.segments![0].revenue += 100e6;
    expect(() =>
      validateV2(
        companyFromFilingPeriods(chd.identity, [
          { ...original, originalStatementCorroboration: proof }
        ])
      )
    ).toThrow();
    const missingFlow = structuredClone(chd.original);
    delete missingFlow.metrics.pretaxIncome;
    delete missingFlow.metricSources.pretaxIncome;
    expect(() =>
      companyFromFilingPeriods(chd.identity, [
        { ...missingFlow, originalStatementCorroboration: proof }
      ])
    ).toThrow();
    const unrecognized = { ...proof, ruleId: "unreviewed" };
    expect(() =>
      companyFromFilingPeriods(chd.identity, [
        { ...chd.original, originalStatementCorroboration: unrecognized as typeof proof }
      ])
    ).toThrow();
  });

  it("adds the actual original period without displacing existing source selections or exceeding the quota", () => {
    const later: SecFiling = {
      ...chd.filing,
      accession: chd.prior.accession!,
      sourceUrl: chd.prior.sourceUrl,
      filedAt: chd.prior.filedAt,
      reportDate: "2026-06-30"
    };
    const wrongKind = { ...chd.filing, form: "10-K", accession: "0001193125-26-200631" };
    const foreign = { ...chd.filing, form: "6-K", accession: "0001193125-26-200632" };
    const wrongDate = {
      ...chd.filing,
      reportDate: "2026-03-30",
      accession: "0001193125-26-200633"
    };
    const filings = [later, chd.filing, foreign, wrongDate];
    expect(genericFilingTodo(priorCompany(), [], filings)).toEqual([later, chd.filing]);
    expect(genericFilingTodo(priorCompany(), [], filings, 1)).toEqual([later]);
    // A latest annual report is part of the pre-existing selector, but may not
    // use a quarterly period's end date to become an original quarterly source.
    expect(genericFilingTodo(priorCompany(), [], [...filings, wrongKind], 2)).toEqual([
      later,
      wrongKind
    ]);
    expect(genericFilingTodo(originalCompany(), [], [chd.filing])).toEqual([]);
  });
});
