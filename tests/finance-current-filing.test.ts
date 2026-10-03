import { describe, expect, it } from "vitest";
import {
  companyFromFilingPeriods,
  currentFilingCandidates,
  missingStandardHistory
} from "../scripts/finance/current-filing";
import { genericFilingTodo, readGenericFiling } from "../scripts/finance/generic-import";
import { parseInlineXbrl, type ParsedFiling } from "../scripts/finance/ixbrl";
import { businessPeriod, flowPeriod, mergeV2, validateV2 } from "../scripts/finance/v2-model";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

const quarter = reviewedFixture("ABT");
const annual = reviewedFixture("ABTAnnual");
const parsed = parseInlineXbrl(quarter.html);
const candidate = (source = parsed) =>
  currentFilingCandidates(quarter.identity, quarter.filing, source, []);

describe("current SEC filing periods independent of Company Facts indexing", () => {
  it("discovers a newer report and amendment even if retained periods are complete", () => {
    expect(genericFilingTodo(annual.company, [], [annual.filing, quarter.filing])).toEqual([
      quarter.filing
    ]);
    expect(genericFilingTodo(undefined, [], [annual.filing, quarter.filing])).toEqual([
      quarter.filing,
      annual.filing
    ]);
    expect(genericFilingTodo(quarter.company, [], [quarter.filing])).toEqual([]);
    const amendment = {
      ...quarter.filing,
      form: "10-Q/A",
      filedAt: "2026-08-01",
      accession: "0001628280-26-050135"
    };
    expect(genericFilingTodo(quarter.company, [], [quarter.filing, amendment])).toEqual([
      amendment
    ]);
    expect(genericFilingTodo(undefined, [], [{ ...quarter.filing, form: "6-K" }])).toEqual([]);
    expect(genericFilingTodo(undefined, [], [annual.filing, quarter.filing], 1)).toEqual([
      quarter.filing
    ]);
  });

  it.each(["ABT", "ABTAnnual"] as const)(
    "reads %s current periods from actual source dates and revenue",
    (ticker) => {
      const f = reviewedFixture(ticker);
      const [p] = readGenericFiling(f.html, f.identity, f.filing, undefined);
      expect(p.id).toBe(f.basic.id);
      expect(p.startDate).toBe(f.basic.startDate);
      expect(p.endDate).toBe(f.filing.reportDate);
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(p.metrics).toMatchObject(
        ticker === "ABT"
          ? {
              revenue: 12593e6,
              totalOperatingCosts: 10900e6,
              operatingIncome: 1693e6,
              pretaxIncome: 1524e6,
              incomeTax: 596e6,
              netIncome: 928e6
            }
          : {
              revenue: 44328e6,
              totalOperatingCosts: 36275e6,
              operatingIncome: 8053e6,
              pretaxIncome: 8466e6,
              incomeTax: 1942e6,
              netIncome: 6524e6
            }
      );
      expect(flowPeriod(p)).toBeDefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(() => validateV2(companyFromFilingPeriods(f.identity, [p]))).not.toThrow();
      const fresh: (typeof p)[] = [];
      readGenericFiling(f.html, f.identity, f.filing, undefined, fresh);
      expect(fresh).toEqual([]);
    }
  );

  it("adds a current quarter while retaining prior source history and clears resolved lag warnings", () => {
    const lag =
      "SEC lists a report ending 2026-06-30, but supported standard facts currently reach only 2025-12-31. Later figures are not yet available in this view.";
    const baseline = { ...annual.company, warnings: [...annual.company.warnings, lag] };
    const [p] = readGenericFiling(quarter.html, quarter.identity, quarter.filing, baseline);
    const merged = mergeV2(
      baseline,
      companyFromFilingPeriods(quarter.identity, [p], baseline.warnings)
    );
    expect(merged.annual).toEqual(baseline.annual);
    expect(merged.quarterly[0].id).toBe("2026-Q2");
    expect(merged.warnings).not.toContain(lag);
    expect(baseline.warnings).toContain(lag);
  });

  it("does not publish a revenue-only candidate or silently replace conflicting same-filing values", () => {
    const revenue = parsed.facts.find(
      (f) =>
        f.tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" &&
        f.context.start === "2026-04-01" &&
        !Object.keys(f.context.dimensions).length
    )!;
    const originalFact = [
      ...quarter.html.matchAll(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/gi)
    ].find(
      ([node]) =>
        node.includes(`contextRef="${revenue.context.id}"`) &&
        node.includes(`name="${revenue.tag}"`)
    )![0];
    const sourceOnly = quarter.html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, "") + originalFact;
    expect(readGenericFiling(sourceOnly, quarter.identity, quarter.filing, undefined)).toEqual([]);
    const conflict = structuredClone(quarter.basic);
    conflict.metrics.revenue! += 100e6;
    const changes = readGenericFiling(quarter.html, quarter.identity, quarter.filing, {
      ...quarter.company,
      quarterly: [conflict]
    });
    expect(changes.some((p) => p.coverage.sankey || p.coverage.segments)).toBe(false);
    expect(() => companyFromFilingPeriods(quarter.identity, [])).toThrow(/No validated/);
    expect(missingStandardHistory(new Error("Company Facts CIK does not match the catalog."))).toBe(
      false
    );
  });

  it("withholds missing/wrong metadata, YTD dates, foreign currency, typed or dimensional revenue", () => {
    const mutate = (change: (p: ParsedFiling) => void) => {
      const p = structuredClone(parsed);
      change(p);
      return candidate(p);
    };
    for (const result of [
      mutate((p) => {
        p.fiscalPeriod = "FY";
      }),
      mutate((p) => {
        p.fiscalYear = 0;
      }),
      mutate((p) => {
        p.periodEnd = "2026-03-31";
      }),
      mutate((p) => {
        p.facts.forEach((f) => {
          f.context.start = "2026-01-01";
        });
      }),
      mutate((p) => {
        p.facts.forEach((f) => {
          f.currency = "TWD";
        });
      }),
      mutate((p) => {
        p.facts.forEach((f) => {
          f.context.typed = true;
        });
      }),
      mutate((p) => {
        p.facts.forEach((f) => {
          f.context.dimensions = { "srt:GeographicalAxis": "test:US" };
        });
      })
    ])
      expect(result).toEqual([]);
    expect(
      currentFilingCandidates(
        quarter.identity,
        { ...quarter.filing, filedAt: "2027-07-28" },
        parsed,
        []
      )
    ).toEqual([]);
    expect(
      currentFilingCandidates(
        quarter.identity,
        { ...quarter.filing, reportDate: "2026-06-31" },
        parsed,
        []
      )
    ).toEqual([]);
  });

  it("rejects ambiguous starts, equally precise conflicting copies and foreign issuer identity", () => {
    const fact = parsed.facts.find(
      (f) =>
        f.tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" &&
        f.context.start === "2026-04-01" &&
        !Object.keys(f.context.dimensions).length
    )!;
    expect(
      candidate({
        ...parsed,
        facts: [
          ...parsed.facts,
          { ...fact, context: { ...fact.context, id: "ambiguous", start: "2026-04-02" } }
        ]
      })
    ).toEqual([]);
    expect(
      candidate({ ...parsed, facts: [...parsed.facts, { ...fact, value: fact.value + 1e6 }] })
    ).toEqual([]);
    expect(() =>
      candidate({ ...parsed, facts: [{ ...fact, context: { ...fact.context, cik: "42" } }] })
    ).toThrow(/identity mismatch/);
    expect(() =>
      currentFilingCandidates(
        quarter.identity,
        { ...quarter.filing, sourceUrl: "https://example.com/filing" },
        parsed,
        []
      )
    ).toThrow(/identity mismatch/);
  });

  it("keeps financial revenue scope conservative unless SEC SIC confirms business services", () => {
    const identity = { ...quarter.identity, sector: "Financials" };
    expect(currentFilingCandidates(identity, quarter.filing, parsed, [])).toEqual([]);
    expect(currentFilingCandidates(identity, quarter.filing, parsed, [], "6021")).toEqual([]);
    expect(currentFilingCandidates(identity, quarter.filing, parsed, [], "7389")).toHaveLength(1);
    const bank = {
      ...parsed,
      facts: parsed.facts.map((f) => ({
        ...f,
        tag:
          f.tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"
            ? "us-gaap:RevenuesNetOfInterestExpense"
            : f.tag
      }))
    };
    expect(currentFilingCandidates(identity, quarter.filing, bank, [], "6021")).toHaveLength(1);
  });
});
