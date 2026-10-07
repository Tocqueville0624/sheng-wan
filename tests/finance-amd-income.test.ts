import { describe, it, expect } from "vitest";
import saved from "./fixtures/finance/amd-retained-income.json";
import { amdFixture } from "./fixtures/finance/amd-fixture";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import { enrichAmdIncomePeriods } from "../scripts/finance/amd-income-v2";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import {
  originalAmdInlineIncome,
  amdIncomeFlowView
} from "../src/features/finance/amd-inline-income";
import { flowPeriod, validateV2, mergeV2 } from "../scripts/finance/v2-model";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import {
  decodeOriginalRows,
  encodeOriginalRows
} from "../src/features/finance/original-cell-tuples";

function recover(id: string) {
  const prior = structuredClone(saved.periods.find((p) => p.id === id)!) as PeriodV2,
    source = amdFixture(id === "FY2017" ? "FY2019" : id === "FY2021" ? "FY2023" : "FY2025"),
    out = enrichAmdIncomePeriods(
      source.html,
      source.identity,
      source.source.filing,
      [prior],
      parseInlineXbrl(source.html)
    );
  expect(out).toHaveLength(1);
  return { prior, source, p: out[0] };
}
describe("AMD complete original income scope while retaining indexed financial facts", () => {
  it("keeps every saved business identifier and source detail during a fresh same-filing reconstruction", () => {
    const old = structuredClone(saved.existingBusinessPeriod) as PeriodV2,
      source = amdFixture("FY2022"),
      seed = structuredClone(old);
    delete seed.segments;
    delete seed.segmentSourceUrl;
    delete seed.segmentBasis;
    delete seed.businessBreakdownSource;
    seed.coverage.segments = false;
    const fresh = readGenericFiling(
        source.html,
        source.identity,
        source.source.filing,
        companyFromFilingPeriods(source.identity, [seed]),
        []
      ),
      incoming = companyFromFilingPeriods(source.identity, fresh),
      before = companyFromFilingPeriods(source.identity, [old]),
      reconstructed = fresh.find((p) => p.id === old.id)!;
    expect(reconstructed).toBeDefined();
    expect(reconstructed.segments?.map((s) => s.id)).not.toEqual(old.segments?.map((s) => s.id));
    const merged = mergeV2(before, incoming),
      kept = merged.annual.find((p) => p.id === old.id)!;
    expect(kept).toEqual(old);
  });
  it("adds original income proof to an existing business chart without replacing its history identifiers", () => {
    const old = structuredClone(saved.periods.find((p) => p.id === "FY2021")) as PeriodV2,
      source = amdFixture("FY2023"),
      seed = structuredClone(old);
    delete seed.segments;
    delete seed.segmentSourceUrl;
    delete seed.segmentBasis;
    delete seed.businessBreakdownSource;
    seed.coverage.segments = false;
    const fresh = readGenericFiling(
        source.html,
        source.identity,
        source.source.filing,
        companyFromFilingPeriods(source.identity, [seed]),
        []
      ),
      reconstructed = fresh.find((p) => p.id === old.id)!;
    expect(reconstructed.amdInlineIncome).toBeDefined();
    const merged = mergeV2(
        companyFromFilingPeriods(source.identity, [old]),
        companyFromFilingPeriods(source.identity, [reconstructed])
      ),
      kept = merged.annual[0];
    for (const [key, value] of Object.entries(old))
      if (key !== "coverage") expect(kept[key as keyof PeriodV2]).toEqual(value);
    expect(kept.amdInlineIncome).toEqual(reconstructed.amdInlineIncome);
    expect(flowPeriod(kept)).toBeDefined();
  });
  for (const id of ["FY2017", "FY2021", "FY2025"])
    it(`${id} retains every saved field while recovering a conserved original profit flow`, () => {
      const { prior, source, p } = recover(id);
      for (const [k, v] of Object.entries(prior))
        if (k !== "coverage") expect(p[k as keyof PeriodV2]).toEqual(v);
      expect(p.coverage).toEqual({ ...prior.coverage, sankey: true });
      const scoped = originalAmdInlineIncome(p, p.amdInlineIncome!);
      expect(scoped.retainedPretaxIncludesEquity).toBe(true);
      expect(scoped.metrics.pretaxIncome! + scoped.metrics.equityMethodIncome!).toBe(
        p.metrics.pretaxIncome
      );
      expect(
        scoped.metrics.pretaxIncome! -
          scoped.metrics.incomeTax! +
          scoped.metrics.equityMethodIncome! +
          (scoped.metrics.discontinuedOperationsIncome ?? 0)
      ).toBe(p.metrics.netIncome);
      expect(flowPeriod(p)).toBeDefined();
      const graph = buildStatementFlow(flowPeriod(p)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw Error(graph.reason);
      const pre = graph.graph.nodes.find((n) => n.id === "pretax")!;
      expect(pre.signedAmount ?? pre.amount).toBe(scoped.metrics.pretaxIncome);
      expect(JSON.stringify(prior)).toBe(JSON.stringify(saved.periods.find((p) => p.id === id)));
      validateV2(companyFromFilingPeriods(source.identity, [p]));
    });
  const mutations: [string, (p: PeriodV2) => void][] = [
    ["saved inclusive pretax amount", (p) => (p.metrics.pretaxIncome! += 1000000)],
    [
      "saved inclusive pretax concept",
      (p) => (p.metricSources.pretaxIncome!.tag = "amd:UnreviewedPretax")
    ],
    ["original accession", (p) => (p.accession = "0000002488-26-000123")],
    ["source query", (p) => (p.sourceUrl += "?unreviewed=1")],
    ["original fiscal calendar", (p) => (p.amdInlineIncome!.fiscalCalendar = "calendar year")],
    ["unknown proof field", (p) => Object.assign(p.amdInlineIncome!, { unknownContract: true })],
    [
      "missing complete comparative income",
      (p) => {
        const rows = decodeOriginalRows(p.amdInlineIncome!.rows);
        rows
          .find((r) => r.cells.some((c) => c.fact?.tag.includes("NetIncomeLoss")))!
          .cells.find((c) => c.fact)!.fact = undefined;
        p.amdInlineIncome!.rows = encodeOriginalRows(rows);
      }
    ],
    [
      "original equity sign",
      (p) => {
        const rows = decodeOriginalRows(p.amdInlineIncome!.rows),
          c = rows
            .find((r) =>
              r.cells.some((c) => c.fact?.tag.includes("IncomeLossFromEquityMethodInvestments"))
            )!
            .cells.find((c) => c.fact)!;
        c.fact!.value = -c.fact!.value;
        c.fact!.declarations[0].sign = "-";
        p.amdInlineIncome!.rows = encodeOriginalRows(rows);
      }
    ],
    [
      "hidden untagged income amount",
      (p) => {
        const rows = decodeOriginalRows(p.amdInlineIncome!.rows);
        rows.at(-1)!.cells.find((c) => !c.fact && c.columnIndex > 0)!.label = "123";
        p.amdInlineIncome!.rows = encodeOriginalRows(rows);
      }
    ],
    [
      "original row caption",
      (p) => {
        const rows = decodeOriginalRows(p.amdInlineIncome!.rows);
        rows.find((r) =>
          r.cells.some((c) => c.fact?.tag.includes("IncomeTaxExpenseBenefit"))
        )!.cells[0].label = "Hypothetical tax";
        p.amdInlineIncome!.rows = encodeOriginalRows(rows);
      }
    ],
    ["unsupported saved supplementary metric", (p) => (p.metrics.totalExpenses = 123)],
    [
      "mixed source rounding",
      (p) =>
        (p.afterTaxReconciliation = { label: "Source rounding", amount: 1, sourceUrl: p.sourceUrl })
    ],
    [
      "wrong source decimals",
      (p) => {
        const rows = decodeOriginalRows(p.amdInlineIncome!.rows),
          c = rows.at(-1)!.cells.find((c) => c.fact)!;
        c.fact!.decimals = -5;
        c.fact!.declarations[0].decimals = "-5";
        p.amdInlineIncome!.rows = encodeOriginalRows(rows);
      }
    ]
  ];
  for (const [name, change] of mutations)
    it(`withholds ${name} across stored replay and direct graph reads`, () => {
      const { p } = recover("FY2025");
      change(p);
      expect(() => amdIncomeFlowView(p)).toThrow();
      expect(flowPeriod(p)).toBeUndefined();
      expect(buildStatementFlow(p as ReturnType<typeof amdIncomeFlowView>).ok).toBe(false);
    });
  it("does not reinterpret a currently valid source-only statement", () => {
    const s = amdFixture("FY2025"),
      p = s.source.expectedCurrent;
    expect(flowPeriod(p)).toBeDefined();
    expect(
      enrichAmdIncomePeriods(s.html, s.identity, s.source.filing, [p], parseInlineXbrl(s.html))
    ).toEqual([]);
  });
});
