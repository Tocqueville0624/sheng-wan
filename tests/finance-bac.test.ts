import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { bacCases, bacFixture } from "./fixtures/finance/bac-fixture";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichBacBusinessPeriods } from "../scripts/finance/bac-business-v2";
import { enrichBacIncomePeriods } from "../scripts/finance/bac-income-v2";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { originalRevenueGrid } from "../scripts/finance/original-revenue-grid";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { bacRevenueProblem } from "../src/features/finance/bac-revenue";
import { decodeBacRows, packBacOriginalRows } from "../src/features/finance/bac-original-rows";
import {
  decodeOriginalRows,
  encodeOriginalRows
} from "../src/features/finance/original-cell-tuples";
import {
  originalBacMillionDollarRows,
  originalMillionDollarRows
} from "../src/features/finance/original-revenue-rows";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";

const fixtures = new Map(bacCases.map((id) => [id, bacFixture(id)])),
  fixture = (id: (typeof bacCases)[number]) => fixtures.get(id)!;
const current = (id: (typeof bacCases)[number]) =>
  structuredClone(fixture(id).source.expectedCurrent);
const proof = (p: PeriodV2) => p.businessBreakdownSource!.bacRevenue!;

describe("BAC original FTE business revenue and its reported GAAP bridge", () => {
  it("withholds the actually contradictory 2020 Q1 original without changing its component signs", () => {
    const s = bacFixture("2020-Q1-conflicting"),
      hash = (v: string) => createHash("sha256").update(v).digest("hex"),
      tables = [...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
    expect(hash(s.html)).toBe(s.source.excerptSha256);
    for (const m of s.source.tableIndexMapping)
      expect(hash(tables[m.fixtureIndex][0])).toBe(m.tableSha256);
    const out = readGenericFiling(s.html, s.identity, s.source.filing, undefined, []),
      p = out.find((p) => p.endDate === s.source.filing.reportDate)!;
    expect(p).toEqual(s.source.expectedCurrent);
    expect(flowPeriod(p)).toBeDefined();
    expect(p.segments).toBeUndefined();
    const diagnostics: { id: string; reason: string }[] = [];
    expect(
      enrichBacBusinessPeriods(
        s.html,
        s.identity,
        s.source.filing,
        [p],
        parseInlineXbrl(s.html),
        (d) => diagnostics.push(d)
      )
    ).toEqual([]);
    expect(diagnostics).toContainEqual({
      id: "2020-Q1",
      reason: "Original BAC independent reconciliation fails"
    });
    const recovered = fixture("2021-Q1").source.retained.find(
      (r) => r.prior.id === "2020-Q1"
    )!.expected;
    expect(businessPeriod(recovered)).toBeDefined();
    expect(recovered.metrics.revenue).toBe(p.metrics.revenue);
    expect(recovered.accession).not.toBe(p.accession);
  });
  for (const id of bacCases) {
    it(`${id} reads complete unmodified original source tables without saved company data`, () => {
      const s = fixture(id),
        hash = (v: string) => createHash("sha256").update(v).digest("hex"),
        tables = [...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
      expect(hash(s.html)).toBe(s.source.excerptSha256);
      for (const m of s.source.tableIndexMapping)
        expect(hash(tables[m.fixtureIndex][0])).toBe(m.tableSha256);
      const out = readGenericFiling(s.html, s.identity, s.source.filing, undefined, []),
        p = out.find((p) => p.endDate === s.source.filing.reportDate)!;
      expect(p).toEqual(s.source.expectedCurrent);
      expect(bacRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(flowPeriod(p)).toBeDefined();
      validateV2(companyFromFilingPeriods(s.identity, out));
      const original = proof(p),
        groups = [
          original.primary,
          ...original.business,
          ...(original.reconciliation ? [original.reconciliation] : [])
        ].map((t) => decodeBacRows(t.rows, original.resources)),
        packed = packBacOriginalRows(groups);
      expect(packed.resources).toEqual(original.resources);
      expect(packed.rows).toEqual(
        [
          original.primary,
          ...original.business,
          ...(original.reconciliation ? [original.reconciliation] : [])
        ].map((t) => t.rows)
      );
      for (const [i, rows] of groups.entries())
        expect(decodeBacRows(packed.rows[i], packed.resources)).toEqual(rows);
      expect(
        p.segments!.reduce((n, s) => n + s.revenue, 0) +
          p.revenueAdjustments!.reduce((n, a) => n + a.revenue, 0)
      ).toBe(p.metrics.revenue);
      const graph = buildStatementFlow(flowPeriod(p)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw Error(graph.reason);
      for (const s of p.segments!)
        expect(
          graph.graph.links
            .filter((l) => l.source === `segment-${s.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(s.revenue);
      for (const a of p.revenueAdjustments!)
        expect(
          graph.graph.links
            .filter((l) => l.target === `adjustment-${a.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(-a.revenue);
    });
    if (fixture(id).source.retained.length)
      it(`${id} preserves all saved financial fields and recovers each original comparison period`, () => {
        const s = fixture(id),
          parsed = parseInlineXbrl(s.html);
        for (const { prior, expected } of s.source.retained) {
          const changes = enrichBacBusinessPeriods(
              s.html,
              s.identity,
              s.source.filing,
              [prior],
              parsed
            ),
            p = changes.find((p) => p.id === prior.id)!;
          expect(p).toEqual(expected);
          expect(p.metrics).toEqual(prior.metrics);
          expect(p.metricSources).toEqual(prior.metricSources);
          for (const [k, v] of Object.entries(prior))
            if (k !== "coverage") expect(p[k as keyof PeriodV2]).toEqual(v);
          expect(!!flowPeriod(p)).toBe(!!flowPeriod(prior));
          expect(businessPeriod(p)).toBeDefined();
          const income = enrichBacIncomePeriods(s.html, s.identity, s.source.filing, [p], parsed);
          for (const next of income) {
            expect(next.metrics).toMatchObject(prior.metrics);
            expect(next.metricSources).toMatchObject(prior.metricSources);
            for (const [k, v] of Object.entries(prior))
              if (!["coverage", "metrics", "metricSources"].includes(k))
                expect(next[k as keyof PeriodV2]).toEqual(v);
          }
        }
      });
  }
  it("uses independently transcribed annual and quarterly reported amounts and deductions", () => {
    for (const [id, values, other, fte, revenue] of [
      ["2026-Q2", [11336, 6871, 6236, 8022], -744, -163, 31558],
      ["FY2025", [43673, 24883, 24108, 24096], -3054, -609, 113097]
    ] as const) {
      const p = current(id);
      expect(p.segments!.map((s) => s.revenue)).toEqual(values.map((v) => v * 1000000));
      expect(p.revenueAdjustments!.map((a) => a.revenue)).toEqual([other * 1000000, fte * 1000000]);
      expect(p.metrics.revenue).toBe(revenue * 1000000);
      const adjustment = p.revenueAdjustments![1];
      expect(adjustment.revenueSource!.value).toBe(-fte * 1000000);
      expect(adjustment.revenueSource!.calculation).toEqual({
        method: "deduct-reported-fte-adjustment"
      });
    }
  });
  it("keeps a reported positive All Other contribution as an additional business source", () => {
    const source = fixture("FY2018"),
      p = source.source.retained.find((p) => p.prior.id === "FY2016")!.expected;
    expect(p.segments!.find((s) => s.label === "All Other")?.revenue).toBe(685000000);
    expect(p.revenueAdjustments!.map((a) => a.id)).toEqual(["bac-fte-basis-adjustment"]);
  });
  it("retains 66 physical source columns without weakening generic geometry limits", () => {
    const s = fixture("2026-Q2"),
      pr = proof(s.source.expectedCurrent),
      rows = decodeBacRows(pr.business[0].rows, pr.resources),
      encoded = encodeOriginalRows(rows);
    expect(Math.max(...rows.flatMap((r) => r.cells.map((c) => c.columnIndex + c.span)))).toBe(66);
    expect(() => decodeOriginalRows(encoded)).toThrow();
    expect(() => originalMillionDollarRows(rows, pr.units, "0000070858")).toThrow();
    expect(() => originalBacMillionDollarRows(rows, pr.units)).not.toThrow();
    expect(() =>
      originalRevenueGrid(
        s.html,
        parseInlineXbrl(s.html),
        "0000002488",
        6,
        [-6],
        "bac-original-96-columns"
      )
    ).toThrow();
  });
  it("fits all 30 retained periods with complete lossless evidence under the unchanged storage limit", () => {
    const retained = [...fixtures.values()].flatMap((s) =>
      s.source.retained.map((r) => r.expected)
    );
    expect(new Set(retained.map((p) => p.id)).size).toBe(30);
    const company = companyFromFilingPeriods(fixture("2026-Q2").identity, retained);
    expect(JSON.stringify(company).length).toBeLessThan(1500000);
    validateV2(company);
  });
  const mutations: [string, (p: PeriodV2) => void][] = [
    [
      "rebound currency namespace",
      (p) => {
        proof(p).originalNotes![0].root = proof(p).originalNotes![0].root.replace(
          "http://www.xbrl.org/2003/iso4217",
          "https://invalid.example/currency"
        );
      }
    ],
    [
      "unused original context",
      (p) => {
        proof(p).resources.contexts.push(structuredClone(proof(p).resources.contexts[0]));
      }
    ],
    [
      "unused original fact",
      (p) => {
        proof(p).resources.facts.push(structuredClone(proof(p).resources.facts[0]));
      }
    ],
    [
      "unknown proof region field",
      (p) => {
        Object.assign(proof(p).primary, { estimated: true });
      }
    ],
    [
      "missing comparative column",
      (p) => {
        proof(p)
          .business[0].rows.find((r) => r[1].some((c) => c[4] !== undefined))![1]
          .splice(8, 1);
      }
    ],
    [
      "changed branch amount",
      (p) => {
        p.segments![0].revenue++;
      }
    ],
    [
      "changed original declaration",
      (p) => {
        proof(p).resources.facts[0][4][0][1] = 3;
      }
    ],
    [
      "foreign original issuer",
      (p) => {
        proof(p).resources.contexts[0][1] = "0000002488";
      }
    ],
    [
      "changed original period",
      (p) => {
        proof(p).resources.contexts[0][3] = "2026-01-01";
      }
    ],
    [
      "foreign business axis",
      (p) => {
        const c = proof(p).resources.contexts.find((c) => Object.keys(c[5]).length === 2)!;
        c[5]["srt:GeographicalAxis"] = "us-gaap:UnitedStatesMember";
      }
    ],
    [
      "business renamed by tag guessing",
      (p) => {
        p.segments![0].label = "Other revenue";
      }
    ],
    [
      "FTE deduction turned into reported negative fact",
      (p) => {
        p.revenueAdjustments![1].revenueSource!.value *= -1;
      }
    ],
    [
      "business deduction omitted",
      (p) => {
        p.revenueAdjustments!.shift();
      }
    ],
    [
      "original footnote omitted",
      (p) => {
        proof(p).originalNotes!.pop();
      }
    ],
    [
      "original FTE note value changed",
      (p) => {
        proof(p).originalNotes![0].html = proof(p).originalNotes![0].html.replace(">163<", ">164<");
      }
    ],
    [
      "original note currency changed",
      (p) => {
        proof(p).originalNotes![0].units[0] = proof(p).originalNotes![0].units[0].replace(
          "iso4217:USD",
          "iso4217:TWD"
        );
      }
    ],
    [
      "original note calendar changed",
      (p) => {
        proof(p).originalNotes![0].html = proof(p).originalNotes![0].html.replace(
          "June 30",
          "September 30"
        );
      }
    ],
    [
      "manufactured residual",
      (p) => {
        p.revenueAdjustments!.push({ id: "balance", label: "Other", revenue: 0 });
      }
    ],
    [
      "mixed proof method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "source identity changed",
      (p) => {
        p.accession = "0000002488-26-000001";
      }
    ]
  ];
  for (const [label, change] of mutations)
    it(`withholds ${label}`, () => {
      const p = current("2026-Q2");
      change(p);
      expect(bacRevenueProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
    });
});
