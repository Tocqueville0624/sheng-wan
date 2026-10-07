import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { amdCases, amdFixture } from "./fixtures/finance/amd-fixture";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { enrichAmdBusinessPeriods } from "../scripts/finance/amd-business-v2";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { amdBusinessProfiles } from "../src/features/finance/amd-business-profiles";
import {
  originalAmdRevenuePartition,
  amdRevenueProblem
} from "../src/features/finance/amd-revenue";
import { canonicalAmdSource, amdFiscalScope } from "../src/features/finance/amd-source";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import {
  decodeOriginalRows,
  encodeOriginalRows
} from "../src/features/finance/original-cell-tuples";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import type { AmdRevenueProof } from "../src/features/finance/amd-types";
import type { OriginalCellTuple } from "../src/features/finance/original-cell-tuples";

const fixtures = new Map(amdCases.map((id) => [id, amdFixture(id)]));
const fixture = (id: (typeof amdCases)[number]) => fixtures.get(id)!;
const current = (id: (typeof amdCases)[number]) =>
  structuredClone(fixture(id).source.expectedCurrent);
const proof = (p: PeriodV2) => p.businessBreakdownSource!.amdRevenue!;
const moneyRows = (p: PeriodV2) => proof(p).rows.filter((r) => r[1].some((c) => c[4]));
const firstMoney = (p: PeriodV2) => moneyRows(p)[0][1].find((c) => c[4])!;
const changeAmount = (c: OriginalCellTuple) => {
  c[3] = "1";
  c[4]!.value = 1000000;
};

describe("AMD complete original business revenues and independently corroborated historical row conflicts", () => {
  for (const id of amdCases) {
    it(`${id} replays complete unmodified primary/business tables without saved facts`, () => {
      const s = fixture(id),
        hash = (v: string) => createHash("sha256").update(v).digest("hex");
      expect(hash(s.html)).toBe(s.source.excerptSha256);
      const tables = [...s.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
      for (const mapping of s.source.tableIndexMapping)
        expect(hash(tables[mapping.fixtureIndex][0])).toBe(mapping.tableSha256);
      const out = readGenericFiling(s.html, s.identity, s.source.filing, undefined, []),
        p = out.find((p) => p.endDate === s.source.filing.reportDate)!;
      expect(p).toEqual(s.source.expectedCurrent);
      expect(amdRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(flowPeriod(p)).toBeDefined();
      validateV2(companyFromFilingPeriods(s.identity, out));
      expect(p.segments!.reduce((n, b) => n + b.revenue, 0)).toBe(p.metrics.revenue);
      expect(
        p.segments!.every((b) => b.grossProfit === undefined && b.grossProfitSource === undefined)
      ).toBe(true);
      expect(encodeOriginalRows(decodeOriginalRows(proof(p).rows))).toEqual(proof(p).rows);
      const graph = buildStatementFlow(flowPeriod(p)!);
      expect(graph.ok).toBe(true);
      if (!graph.ok) throw Error(graph.reason);
      for (const b of p.segments!)
        expect(
          graph.graph.links
            .filter((l) => l.source === `segment-${b.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(b.revenue);
    });
    if (fixture(id).source.retained.length)
      it(`${id} adds only missing business evidence while preserving every retained field`, () => {
        const s = fixture(id);
        for (const { prior, expected } of s.source.retained) {
          const changes = enrichAmdBusinessPeriods(
              s.html,
              s.identity,
              s.source.filing,
              [prior],
              parseInlineXbrl(s.html)
            ),
            p = changes.find((p) => p.id === prior.id)!;
          expect(p).toEqual(expected);
          expect(p.metrics).toEqual(prior.metrics);
          expect(p.metricSources).toEqual(prior.metricSources);
          for (const [k, v] of Object.entries(prior))
            if (!["coverage", "metrics", "metricSources"].includes(k))
              expect(p[k as keyof PeriodV2]).toEqual(v);
          expect(!!flowPeriod(p)).toBe(!!flowPeriod(prior));
          expect(businessPeriod(p)).toBeDefined();
        }
      });
  }
  it("covers all nine column classifications with actual original fixtures", () => {
    const profiles = new Set<string>();
    for (const id of amdCases) {
      const p = current(id),
        rows = moneyRows(p),
        amounts = rows.at(-1)![1].filter((c) => c[4]);
      for (const amount of amounts) {
        const columns = rows.map((r) => {
            const c = r[1].find(
              (c) => c[4]?.startDate === amount[4]!.startDate && c[4].endDate === amount[4]!.endDate
            )!;
            return { label: r[1][0][3], tag: c[4]!.tag, dimensions: c[4]!.dimensions };
          }),
          pr = amdBusinessProfiles.find(
            (pr) => canonicalAmdSource(pr.rows) === canonicalAmdSource(columns)
          );
        expect(pr).toBeDefined();
        profiles.add(pr!.id);
      }
    }
    expect(profiles.size).toBe(9);
  });
  it("counts Client and Gaming leaves once and preserves the reported parent", () => {
    const p = current("FY2025");
    expect(p.segments!.map((s) => s.label)).toEqual([
      "Data Center",
      "Client",
      "Gaming",
      "Embedded"
    ]);
    expect(p.businessBreakdownSource!.omittedSubtotals).toHaveLength(1);
    const parent = p.businessBreakdownSource!.omittedSubtotals[0];
    expect(parent.label).toBe("Total Client and Gaming");
    expect(parent.value).toBe(p.segments![1].revenue + p.segments![2].revenue);
  });
  for (const id of ["2024-Q3", "2024-Q2", "2024-Q1", "2023-Q3", "2023-Q2", "2023-Q1"] as const)
    it(`${id} retains disputed original dimensions and the complete separate MD&A corroboration`, () => {
      const p = current(id),
        pr = proof(p);
      expect(pr.classificationBasis).toBe("original-row-captions-corroborated-by-mda");
      expect(pr.independentMda).toBeDefined();
      expect(
        p
          .segments!.slice(0, 3)
          .map((s) => [
            s.label,
            s.revenueSource!.dimensions["us-gaap:StatementBusinessSegmentsAxis"]
          ])
      ).toEqual([
        ["Data Center", "amd:ClientMember"],
        ["Client", "amd:GamingMember"],
        ["Gaming", "amd:DataCenterMember"]
      ]);
      expect(p.segmentBasis).toContain("disagree with their printed row captions");
      expect(decodeOriginalRows(pr.independentMda!.rows)).toEqual(
        decodeOriginalRows(pr.rows).map((r) => ({
          rowIndex: r.rowIndex,
          cells: r.cells.map((c) => ({
            columnIndex: c.columnIndex,
            span: c.span,
            rowSpan: c.rowSpan,
            label: c.label
          }))
        }))
      );
    });
  it("preserves the actual Xilinx acquisition revenue and explicit comparative zero", () => {
    const p = current("2022-Q1");
    expect(p.segments!.map((s) => s.label)).toEqual([
      "Computing and Graphics",
      "Enterprise, Embedded and Semi-Custom",
      "Xilinx"
    ]);
    expect(p.segments![2].revenueSource!.tag).toBe(
      "us-gaap:BusinessCombinationProFormaInformationRevenueOfAcquireeSinceAcquisitionDateActual"
    );
    const original = decodeOriginalRows(proof(p).rows).find((r) => r.cells[0].label === "Xilinx")!;
    expect(original.cells.filter((c) => c.fact).map((c) => [c.fact!.value, c.fact!.tag])).toEqual([
      [
        559000000,
        "us-gaap:BusinessCombinationProFormaInformationRevenueOfAcquireeSinceAcquisitionDateActual"
      ],
      [0, "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]
    ]);
  });
  it("handles a 53-week year and the actual April quarter end without a calendar-month guess", () => {
    expect(amdFiscalScope("2021-12-26", "2022-12-31").kind).toBe("annual");
    expect(amdFiscalScope("2023-01-01", "2023-04-01")).toMatchObject({
      year: 2023,
      period: "Q1",
      kind: "quarterly"
    });
    expect(() => amdFiscalScope("2023-01-01", "2023-03-31")).toThrow();
  });
  it("does not substitute primary pretax scope for a differently scoped retained Company Facts value", () => {
    const s = fixture("FY2025"),
      retained = s.source.retained.find((r) => r.prior.id === "FY2025")!;
    expect(retained.prior.metrics.pretaxIncome).toBe(4166000000);
    expect(retained.expected.metrics.pretaxIncome).toBe(4166000000);
    expect(s.source.expectedCurrent.metrics.pretaxIncome).toBe(4140000000);
    expect(retained.expected.coverage.sankey).toBe(false);
  });
});

describe("AMD original-source corruption and incomplete classifications", () => {
  const cases: [string, (p: PeriodV2) => void][] = [
    [
      "issuer",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("/2488/", "/2489/");
      }
    ],
    [
      "foreign accession",
      (p) => {
        p.accession = "0000002488-26-999999";
      }
    ],
    [
      "source query",
      (p) => {
        p.sourceUrl += "?other=1";
      }
    ],
    [
      "source focus",
      (p) => {
        proof(p).reportDate = "2025-12-26";
      }
    ],
    [
      "fiscal calendar",
      (p) => {
        proof(p).fiscalCalendar = proof(p).fiscalCalendar.replace("Saturday", "Sunday");
      }
    ],
    [
      "invented member",
      (p) => {
        firstMoney(p)[4]!.dimensions["us-gaap:StatementBusinessSegmentsAxis"] = "amd:OtherMember";
      }
    ],
    [
      "mixed geography",
      (p) => {
        firstMoney(p)[4]!.dimensions["srt:StatementGeographicalAxis"] = "country:US";
      }
    ],
    [
      "renamed business",
      (p) => {
        moneyRows(p)[0][1][0][3] = "Other business";
      }
    ],
    [
      "changed current amount",
      (p) => {
        changeAmount(firstMoney(p));
      }
    ],
    [
      "changed comparative amount",
      (p) => {
        changeAmount(moneyRows(p)[0][1].filter((c) => c[4])[1]);
      }
    ],
    [
      "changed parent",
      (p) => {
        changeAmount(
          moneyRows(p)
            .find((r) => r[1][0][3] === "Total Client and Gaming")![1]
            .find((c) => c[4])!
        );
      }
    ],
    [
      "missing parent",
      (p) => {
        proof(p).rows = proof(p).rows.filter((r) => r[1][0][3] !== "Total Client and Gaming");
      }
    ],
    [
      "missing branch",
      (p) => {
        proof(p).rows = proof(p).rows.filter((r) => r[1][0][3] !== "Embedded");
      }
    ],
    [
      "duplicate branch",
      (p) => {
        proof(p).rows.splice(5, 0, structuredClone(proof(p).rows[5]));
      }
    ],
    [
      "hidden untagged amount",
      (p) => {
        moneyRows(p)[0][1].find((c) => !c[3] && c[0] > 0)![3] = "123";
      }
    ],
    [
      "wrong dollar scale",
      (p) => {
        firstMoney(p)[4]!.declarations[0].scale = 3;
      }
    ],
    [
      "missing original unit",
      (p) => {
        proof(p).units = [];
      }
    ],
    [
      "changed precision",
      (p) => {
        firstMoney(p)[4]!.decimals = -5;
      }
    ],
    [
      "changed original sign",
      (p) => {
        firstMoney(p)[4]!.declarations[0].sign = "-";
      }
    ],
    [
      "changed physical span",
      (p) => {
        firstMoney(p)[1] = 2;
      }
    ],
    [
      "reordered original rows",
      (p) => {
        proof(p).rows.reverse();
      }
    ],
    [
      "primary alias",
      (p) => {
        proof(p).primary.tableIndex = proof(p).tableIndex;
      }
    ],
    [
      "changed primary revenue",
      (p) => {
        changeAmount(proof(p).primary.revenue[1].find((c) => c[4])!);
      }
    ],
    [
      "changed primary tax",
      (p) => {
        changeAmount(proof(p).primary.tax[1].find((c) => c[4])!);
      }
    ],
    [
      "wrong primary title",
      (p) => {
        proof(p).primary.title = "Consolidated balance sheet";
      }
    ],
    [
      "wrong primary scale caption",
      (p) => {
        proof(p)
          .primary.headerRows.at(-1)![1]
          .find((c) => c[3])![3] = "(In thousands)";
      }
    ],
    [
      "changed date caption",
      (p) => {
        proof(p).rows[2][1].find((c) => /December/.test(c[3]))![3] = "December 26, 2025";
      }
    ],
    [
      "wrong duration caption",
      (p) => {
        proof(p).rows[1][1].find((c) => c[3])![3] = "Three Months Ended";
      }
    ],
    [
      "changed selected business",
      (p) => {
        p.segments![0].revenue += 1000000;
      }
    ],
    [
      "invented subtotal",
      (p) => {
        p.businessBreakdownSource!.omittedSubtotals = [];
      }
    ],
    [
      "hidden source proof through method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "invented additional total",
      (p) => {
        p.revenueAdjustments = [{ id: "extra", label: "Extra", revenue: 1 }];
      }
    ]
  ];
  for (const [name, change] of cases)
    it(`withholds ${name} without deleting original saved evidence`, () => {
      const p = current("FY2025");
      change(p);
      expect(amdRevenueProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
      expect(flowPeriod(p)).toBeUndefined();
    });
  const conflicts: [string, (pr: AmdRevenueProof) => void][] = [
    [
      "omitted conflict basis",
      (pr) => {
        pr.classificationBasis = "original-reported-scopes";
      }
    ],
    [
      "missing independent table",
      (pr) => {
        delete pr.independentMda;
      }
    ],
    [
      "same-table corroboration",
      (pr) => {
        pr.independentMda!.tableIndex = pr.tableIndex;
      }
    ],
    [
      "changed independent row name",
      (pr) => {
        pr.independentMda!.rows[5][1][0][3] = "Gaming";
      }
    ],
    [
      "changed independent comparative amount",
      (pr) => {
        pr.independentMda!.rows[5][1].find((c) => c[3] === "1,321")![3] = "1,322";
      }
    ],
    [
      "missing independent blank",
      (pr) => {
        pr.independentMda!.rows[5][1].splice(1, 1);
      }
    ]
  ];
  for (const [name, change] of conflicts)
    it(`rejects disputed classifications with ${name}`, () => {
      const p = current("2024-Q2");
      change(proof(p));
      expect(amdRevenueProblem(p)).toBeDefined();
    });
  it("withholds a changed source classification without falling back to generic subsets", () => {
    const s = fixture("2026-Q2"),
      html = s.html.replaceAll("amd:DataCenterMember", "amd:UnexpectedNewBusinessMember"),
      changes = readGenericFiling(html, s.identity, s.source.filing, undefined, []);
    expect(changes.some((p) => p.coverage.segments)).toBe(false);
  });
  it("requires all cumulative columns even when selected quarterly revenue still balances", () => {
    const p = current("2026-Q2"),
      row = moneyRows(p)[0],
      cumulative = row[1].filter((c) => c[4])[2];
    changeAmount(cumulative);
    expect(() => originalAmdRevenuePartition(p, proof(p))).toThrow();
  });
  it("leaves an already valid saved company unchanged when new source classification is unknown", () => {
    const s = fixture("FY2025"),
      saved = current("FY2025"),
      before = structuredClone(saved);
    expect(
      enrichAmdBusinessPeriods(
        s.html.replaceAll("amd:DatacenterMember", "amd:UnknownMember"),
        s.identity,
        s.source.filing,
        [saved],
        parseInlineXbrl(s.html.replaceAll("amd:DatacenterMember", "amd:UnknownMember"))
      )
    ).toEqual([]);
    expect(saved).toEqual(before);
  });
});
