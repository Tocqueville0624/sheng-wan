import cloudRetained from "./fixtures/finance/jpm-original-retained-basic.json" with { type: "json" };
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { jpmCases, jpmFixture } from "./fixtures/finance/jpm-fixture";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichJpmBusinessPeriods } from "../scripts/finance/jpm-business-v2";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { originalRevenueGrid } from "../scripts/finance/original-revenue-grid";
import { businessPeriod, flowPeriod, validateV2, mergeV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { jpmRevenueProblem } from "../src/features/finance/jpm-revenue";
import { decodeJpmRows, packJpmOriginalRows } from "../src/features/finance/jpm-original-rows";
import {
  decodeOriginalRows,
  encodeOriginalRows
} from "../src/features/finance/original-cell-tuples";
import { originalMillionDollarRows } from "../src/features/finance/original-revenue-rows";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { CompanyV2, PeriodV2 } from "../src/features/finance/v2-types";
import type { ServiceRevenueRow } from "../src/features/finance/types";
import type { JpmRevenueProof } from "../src/features/finance/jpm-types";

const fixtures = new Map(jpmCases.map((id) => [id, jpmFixture(id)]));
const fixture = (id: (typeof jpmCases)[number]) => fixtures.get(id)!;
const current = (id: (typeof jpmCases)[number]) =>
  structuredClone(fixture(id).source.expectedCurrent);
const proof = (p: PeriodV2) => p.businessBreakdownSource!.jpmRevenue!;
const rows = (p: PeriodV2) =>
  [proof(p).primary, ...proof(p).business].map((r) => decodeJpmRows(r.rows, proof(p).resources));
const repack = (p: PeriodV2, groups: ServiceRevenueRow[][]) => {
  const original = proof(p),
    packed = packJpmOriginalRows(groups);
  original.resources = packed.resources;
  original.primary.rows = packed.rows[0];
  original.business.forEach((r, i) => (r.rows = packed.rows[i + 1]));
};

describe("JPM original complete business net revenue and signed consolidation", () => {
  it("preserves every field of all 30 actual pre-refresh cloud periods when missing original costs and business proofs are added", () => {
    const saved = cloudRetained.company as CompanyV2;
    for (const prior of [...saved.annual, ...saved.quarterly]) {
      const source = [...fixtures.values()].find(
        (s) => s.source.filing.sourceUrl === prior.sourceUrl
      )!;
      expect(source).toBeDefined();
      const before = companyFromFilingPeriods(source.identity, [structuredClone(prior)]);
      const updates = readGenericFiling(
          source.html,
          source.identity,
          source.source.filing,
          before,
          []
        ),
        candidate = updates.find((p) => p.id === prior.id)!;
      expect(candidate).toBeDefined();
      expect(candidate.derived).toBe(true);
      const after = mergeV2(before, companyFromFilingPeriods(source.identity, [candidate])),
        next = [...after.annual, ...after.quarterly].find((p) => p.id === prior.id)!;
      for (const [field, value] of Object.entries(prior))
        if (field === "metrics" || field === "metricSources")
          expect(next[field]).toMatchObject(prior[field]);
        else if (field !== "coverage") expect(next[field as keyof PeriodV2]).toEqual(value);
      expect(next.derived).toBe(false);
      expect(next.metricSources.expensesAndOtherItems!.method).toBe("calculated");
      expect(businessPeriod(next)).toBeDefined();
      expect(flowPeriod(next)).toBeDefined();
      const repeated = mergeV2(after, companyFromFilingPeriods(source.identity, [candidate]));
      expect([...repeated.annual, ...repeated.quarterly].find((p) => p.id === prior.id)).toEqual(
        next
      );
    }
  });

  for (const id of jpmCases) {
    it(`${id} parses unchanged original tables with every primary and business comparison column without saved data`, () => {
      const s = fixture(id),
        hash = (v: string) => createHash("sha256").update(v).digest("hex"),
        tables = [...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
      expect(hash(s.html)).toBe(s.source.excerptSha256);
      for (const table of s.source.tableIndexMapping)
        expect(hash(tables[table.fixtureIndex][0])).toBe(table.tableSha256);
      const out = readGenericFiling(s.html, s.identity, s.source.filing, undefined, []),
        p = out.find((p) => p.endDate === s.source.filing.reportDate)!;
      expect(p).toEqual(s.source.expectedCurrent);
      expect(businessPeriod(p)).toBeDefined();
      expect(flowPeriod(p)).toBeDefined();
      expect(jpmRevenueProblem(p)).toBeUndefined();
      validateV2(companyFromFilingPeriods(s.identity, out));
      const original = proof(p),
        groups = rows(p),
        packed = packJpmOriginalRows(groups);
      expect(packed.resources).toEqual(original.resources);
      expect(packed.rows).toEqual([original.primary, ...original.business].map((r) => r.rows));
      for (const [i, group] of groups.entries())
        expect(decodeJpmRows(packed.rows[i], packed.resources)).toEqual(group);
      expect(
        p.segments!.reduce((n, s) => n + s.revenue, 0) +
          p.revenueAdjustments!.reduce((n, s) => n + s.revenue, 0)
      ).toBe(p.metrics.revenue);
      const graph = buildStatementFlow(flowPeriod(p)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw Error(graph.reason);
      for (const segment of p.segments!)
        expect(
          graph.graph.links
            .filter((l) => l.source === `segment-${segment.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(segment.revenue);
      for (const adjustment of p.revenueAdjustments!)
        expect(
          graph.graph.links
            .filter((l) => l.target === `adjustment-${adjustment.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(-adjustment.revenue);
    });
    if (fixture(id).source.retained.length)
      it(`${id} enriches every retained comparison without replacing existing amounts, provenance or accounting detail`, () => {
        const s = fixture(id),
          parsed = parseInlineXbrl(s.html);
        for (const { prior, expected } of s.source.retained) {
          const p = enrichJpmBusinessPeriods(
            s.html,
            s.identity,
            s.source.filing,
            [structuredClone(prior)],
            parsed
          ).find((p) => p.id === prior.id)!;
          expect(p).toEqual(expected);
          for (const [k, v] of Object.entries(prior))
            if (k !== "coverage") expect(p[k as keyof PeriodV2]).toEqual(v);
          expect(businessPeriod(p)).toBeDefined();
          expect(!!flowPeriod(p)).toBe(!!flowPeriod(prior));
        }
      });
  }
  it("matches independently transcribed complete annual and quarterly business amounts, Corporate and reconciling items", () => {
    for (const [id, values, adjustment, total] of [
      ["FY2025", [76029, 78454, 24073, 7025], -3134, 182447],
      ["2026-Q2", [20272, 24853, 6851, 6046], -675, 57347]
    ] as const) {
      const p = current(id);
      expect(p.segments!.map((s) => s.revenue)).toEqual(values.map((v) => v * 1000000));
      expect(p.revenueAdjustments!.map((a) => a.revenue)).toEqual([adjustment * 1000000]);
      expect(p.revenueAdjustments![0].label).toBe("Reconciling Items");
      expect(p.metrics.revenue).toBe(total * 1000000);
    }
  });
  it("preserves a negative Corporate contribution as its own reported deduction", () => {
    const p = current("FY2021");
    expect(p.revenueAdjustments!.find((s) => s.label === "Corporate")!.revenue).toBe(-3483000000);
    expect(p.segments!.some((s) => s.label === "Corporate")).toBe(false);
  });
  it("keeps the actual merged business caption while retaining legacy 2024 member names and original merger explanation", () => {
    const p = current("2024-Q2");
    expect(p.segments!.map((s) => s.label)).toContain("Commercial & Investment Bank");
    expect(
      p.segments!.find((s) => s.label === "Commercial & Investment Bank")!.revenueSource!
        .dimensions["us-gaap:StatementBusinessSegmentsAxis"]
    ).toBe("jpm:CorporateAndInvestmentBankMember");
    expect(proof(p).originalNotes![0].originalText).toContain(
      "Effective in the second quarter of 2024"
    );
  });
  it("retains 66 physical source columns without changing generic limits", () => {
    const s = fixture("FY2025"),
      parsed = parseInlineXbrl(s.html),
      original = proof(current("FY2025")),
      physical = decodeJpmRows(original.business[0].rows, original.resources),
      raw = [...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)][
        original.business[0].tableIndex
      ][0],
      selected = new Set(physical.map((r) => r.rowIndex));
    expect(Math.max(...physical.flatMap((r) => r.cells.map((c) => c.columnIndex + c.span)))).toBe(
      66
    );
    expect(() =>
      originalRevenueGrid(s.html, parsed, s.identity.cik, 6, [-6]).grid(raw, selected)
    ).toThrow();
    expect(() => originalMillionDollarRows(physical, original.units, s.identity.cik)).toThrow();
    expect(() => decodeOriginalRows(encodeOriginalRows(physical))).toThrow();
    expect(() =>
      originalRevenueGrid(s.html, parsed, "0000070858", 6, [-6], "jpm-original-96-columns")
    ).toThrow();
  });
  const mutations: {
    name: string;
    id?: (typeof jpmCases)[number];
    mutate: (p: PeriodV2, groups: ServiceRevenueRow[][], original: JpmRevenueProof) => void;
    dictionaryOnly?: boolean;
  }[] = [
    {
      name: "swapped conserved business captions",
      mutate: (_, g) => {
        const c = g[1]
          .flatMap((r) => r.cells)
          .filter((c) =>
            ["Consumer & Community Banking", "Commercial & Investment Bank"].includes(c.label)
          );
        [c[0].label, c[1].label] = [c[1].label, c[0].label];
      }
    },
    {
      name: "another business member",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.dimensions[
          "us-gaap:StatementBusinessSegmentsAxis"
        ] = "jpm:AssetandWealthManagementSegmentMember";
      }
    },
    {
      name: "geographic scope substituted",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.dimensions[
          "srt:StatementGeographicalAxis"
        ] = "jpm:UnitedStatesMember";
      }
    },
    {
      name: "missing operating-segment axis",
      mutate: (_, g) => {
        delete g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.dimensions[
          "srt:ConsolidationItemsAxis"
        ];
      }
    },
    {
      name: "issuer context changed",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.cik = "0000070858";
      }
    },
    {
      name: "source issuer path changed",
      mutate: (p) => {
        p.sourceUrl = p.sourceUrl.replace("/19617/", "/70858/");
      }
    },
    {
      name: "accumulated start substituted for quarter",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.startDate = "2026-01-01";
      }
    },
    {
      name: "fiscal-year header changed",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.label === "2026")!.label = "2027";
      }
    },
    {
      name: "annual heading substituted for quarterly",
      mutate: (_, g) => {
        const c = g[1].flatMap((r) => r.cells).find((c) => c.label.startsWith("As of or for"))!;
        c.label = c.label.replace("three months", "year");
      }
    },
    {
      name: "missing YTD region",
      mutate: (_, g, o) => {
        g.pop();
        o.business.pop();
      }
    },
    {
      name: "primary total altered",
      mutate: (_, g) => {
        g[0].at(-1)!.cells.find((c) => c.fact)!.fact!.value += 1000000;
      }
    },
    {
      name: "primary noninterest component removed",
      mutate: (_, g) => {
        g[0].splice(4, 1);
      }
    },
    {
      name: "primary unknown meaning",
      mutate: (_, g) => {
        g[0].find((r) => r.cells[0].label === "Card income")!.cells[0].label =
          "Estimated card revenue";
      }
    },
    {
      name: "raw amount modified",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.label = "999";
      }
    },
    {
      name: "reported scale modified",
      mutate: (_, g) => {
        const d = g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.declarations[0];
        d.scale = 3;
        d.originalScale = "3";
      }
    },
    {
      name: "reported precision modified",
      mutate: (_, g) => {
        const f = g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!;
        f.decimals = -3;
        f.declarations[0].decimals = "-3";
      }
    },
    {
      name: "original sign modified",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!.declarations[0].sign = "-";
      }
    },
    {
      name: "currency modified",
      mutate: (_, g) => {
        Object.assign(g[1].flatMap((r) => r.cells).find((c) => c.fact)!.fact!, { currency: "EUR" });
      }
    },
    {
      name: "untagged numeric cell inserted",
      mutate: (_, g) => {
        g[1]
          .find((r) => r.cells.some((c) => c.fact))!
          .cells.find((c, i) => i > 0 && !c.fact && c.label === "")!.label = "500";
      }
    },
    {
      name: "overlapping physical year cell",
      mutate: (_, g) => {
        g[1].flatMap((r) => r.cells).find((c) => c.fact)!.span++;
      }
    },
    {
      name: "missing original merger note",
      id: "2024-Q2",
      mutate: (_, __, o) => {
        delete o.originalNotes;
      }
    },
    {
      name: "original merger meaning changed coherently",
      id: "2024-Q3",
      mutate: (_, __, o) => {
        const n = o.originalNotes![0];
        n.originalHtml = n.originalHtml.replace("three reportable", "four reportable");
        n.originalText = n.originalText.replace("three reportable", "four reportable");
        n.endOffset = n.offset + n.originalHtml.length;
      }
    },
    {
      name: "legacy Corporate replaced by a modern scope",
      id: "FY2018",
      mutate: (_, g) => {
        for (const row of g[2])
          for (const c of row.cells)
            if (
              c.fact?.dimensions["us-gaap:StatementBusinessSegmentsAxis"] ===
              "us-gaap:CorporateNonSegmentMember"
            )
              c.fact.dimensions = {
                "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
              };
      }
    },
    {
      name: "unused duplicate fact dictionary",
      dictionaryOnly: true,
      mutate: (_, __, o) => {
        o.resources.facts.push(structuredClone(o.resources.facts[0]));
      }
    },
    {
      name: "unused duplicate context dictionary",
      dictionaryOnly: true,
      mutate: (_, __, o) => {
        o.resources.contexts.push(structuredClone(o.resources.contexts[0]));
      }
    },
    {
      name: "invalid source monetary reference",
      dictionaryOnly: true,
      mutate: (_, __, o) => {
        o.business[0].rows.flatMap((r) => r[1]).find((c) => c.length === 5)![4] = 999999;
      }
    },
    {
      name: "extra unknown source profile property",
      mutate: (_, __, o) => {
        Object.assign(o, { estimatedBusiness: true });
      }
    },
    {
      name: "projected amount changed",
      mutate: (p) => {
        p.segments![0].revenue += 1000000;
      }
    },
    {
      name: "projected original provenance changed",
      mutate: (p) => {
        p.segments![0].revenueSource!.tag = "jpm:UnknownRevenue";
      }
    },
    {
      name: "business proof method concealed",
      mutate: (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-matrix";
      }
    }
  ];
  for (const test of mutations)
    it(`rejects ${test.name} on shared stored-proof reads`, () => {
      const p = current(test.id ?? "2026-Q2"),
        original = proof(p),
        groups = rows(p);
      expect(businessPeriod(p)).toBeDefined();
      test.mutate(p, groups, original);
      if (!test.dictionaryOnly) repack(p, groups);
      expect(jpmRevenueProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
    });
});
