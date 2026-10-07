import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { dardenCases, dardenFixture } from "./fixtures/finance/darden-fixture";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { companyFromFilingPeriods } from "../scripts/finance/current-filing";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { dardenRevenueProblem } from "../src/features/finance/darden-revenue";
import {
  dardenInlineIncomeProblem,
  originalDardenInlineIncome
} from "../src/features/finance/darden-inline-income";
import {
  decodeOriginalRows,
  encodeOriginalRows
} from "../src/features/finance/original-cell-tuples";
import { dardenBusinessProfiles } from "../src/features/finance/darden-business-profiles";
import { dardenIncomeProfiles } from "../src/features/finance/darden-income-profiles";
import { canonicalDardenSource } from "../src/features/finance/darden-source";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import type { OriginalCellTuple } from "../src/features/finance/original-cell-tuples";

const fixtures = new Map(dardenCases.map((id) => [id, dardenFixture(id)]));
const fixture = (id: (typeof dardenCases)[number]) => fixtures.get(id)!;
const proof = (p: PeriodV2) => p.businessBreakdownSource!.dardenRevenue!;
const firstMoney = (p: PeriodV2) => proof(p).tables[0].regions[0][3][1].find((c) => c[4])!;
const changeAmount = (c: OriginalCellTuple) => {
  c[3] = "1.1";
  c[4]!.value = 1100000;
};

describe("Darden original restaurant revenues, 52/53-week fiscal dates and already-net discontinued losses", () => {
  for (const id of dardenCases) {
    it(`${id} preserves every retained fact and source while replaying the complete original tables`, () => {
      const s = fixture(id),
        p = s.period;
      expect(createHash("sha256").update(s.html).digest("hex")).toBe(s.source.excerptSha256);
      for (const [key, value] of Object.entries(s.retained.metrics))
        expect(p.metrics[key as keyof typeof p.metrics]).toBe(value);
      for (const [key, value] of Object.entries(s.retained.metricSources))
        expect(p.metricSources[key as keyof typeof p.metricSources]).toEqual(value);
      for (const key of [
        "startDate",
        "endDate",
        "fiscalYear",
        "fiscalQuarter",
        "filedAt",
        "accession",
        "sourceUrl",
        "reportingCurrency",
        "displayCurrency",
        "derived"
      ] as const)
        expect(p[key]).toEqual(s.retained[key]);
      expect(p.segments).toEqual(s.source.expectedBusiness);
      expect(p.segments!.map((b) => b.label)).toEqual([
        "Olive Garden",
        "LongHorn Steakhouse",
        "Fine Dining",
        "Other Business"
      ]);
      expect(p.segments!.reduce((sum, b) => sum + b.revenue, 0)).toBeCloseTo(p.metrics.revenue!, 4);
      expect(
        p.segments!.every((b) => b.grossProfit === undefined && b.grossProfitSource === undefined)
      ).toBe(true);
      expect(p.businessBreakdownSource!.omittedZeroColumns).toHaveLength(1);
      expect(p.businessBreakdownSource!.omittedZeroColumns![0].value).toBe(0);
      expect(dardenRevenueProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(!!p.dardenInlineIncome).toBe(s.source.expectedIncome);
      expect(!!flowPeriod(p)).toBe(s.source.expectedFlow);
      validateV2(companyFromFilingPeriods(s.identity, [p]));
      for (const table of proof(p).tables)
        for (const region of table.regions)
          expect(encodeOriginalRows(decodeOriginalRows(region))).toEqual(region);
      if (p.dardenInlineIncome) {
        expect(dardenInlineIncomeProblem(p)).toBeUndefined();
        expect(encodeOriginalRows(decodeOriginalRows(p.dardenInlineIncome.rows))).toEqual(
          p.dardenInlineIncome.rows
        );
      }
      const flow = flowPeriod(p);
      if (!flow) return;
      const result = buildStatementFlow(flow);
      expect(result.ok).toBe(true);
      if (!result.ok) throw Error(result.reason);
      for (const b of p.segments!)
        expect(
          result.graph.links
            .filter((l) => l.source === `segment-${b.id}`)
            .reduce((n, l) => n + l.value, 0)
        ).toBe(b.revenue);
    });
    it(`${id} imports from the unchanged original excerpt without saved data or Company Facts`, () => {
      const s = dardenFixture(id, true);
      expect(businessPeriod(s.period)).toBeDefined();
      expect(s.period.endDate).toBe(s.source.filing.reportDate);
      expect(!!flowPeriod(s.period)).toBe(s.source.sourceOnlyCurrent[0].flow);
      expect(!!s.period.dardenInlineIncome).toBe(s.source.sourceOnlyCurrent[0].income);
      validateV2(companyFromFilingPeriods(s.identity, s.periods));
      if (s.period.dardenInlineIncome) {
        expect(s.period.metrics.grossProfit).toBeUndefined();
        expect(s.period.metrics.costOfRevenue).toBeUndefined();
      }
    });
  }
  it("covers all six reviewed revenue schemas and all four complete primary ledgers with actual source fixtures", () => {
    const business = new Set<string>(),
      income = new Set<string>();
    for (const s of fixtures.values()) {
      for (const t of proof(s.period).tables)
        for (const r of t.regions) {
          const rows = decodeOriginalRows(r),
            headers = rows[1].cells.filter((c) => c.label && c.columnIndex > 0),
            money = rows[3].cells.filter((c) => c.fact),
            shape = money.map((c, i) => ({
              label: headers[i].label,
              tag: c.fact!.tag,
              dimensions: c.fact!.dimensions
            }));
          const profile = dardenBusinessProfiles.find(
            (p) => canonicalDardenSource(p.rows) === canonicalDardenSource(shape)
          );
          expect(profile).toBeDefined();
          business.add(profile!.id);
        }
      if (s.period.dardenInlineIncome) {
        const monetary = decodeOriginalRows(s.period.dardenInlineIncome.rows).filter((r) =>
            r.cells.some((c) => c.fact)
          ),
          shape = monetary.map((r) => ({
            label: r.cells[0].label.replace(
              /net of tax benefit of \$.*/,
              "net of original reported tax benefits"
            ),
            tag: r.cells.find((c) => c.fact)!.fact!.tag,
            dimensions: r.cells.find((c) => c.fact)!.fact!.dimensions
          })),
          profile = dardenIncomeProfiles.find(
            (p) => canonicalDardenSource(p.rows) === canonicalDardenSource(shape)
          );
        expect(profile).toBeDefined();
        income.add(profile!.id);
      }
    }
    expect(business.size).toBe(6);
    expect(income.size).toBe(4);
  });
  it("keeps three-month and nine-month columns separate and retains the 53-week annual calendar", () => {
    const p = fixture("2026-Q3").period,
      pr = proof(p);
    expect([p.startDate, p.endDate]).toEqual(["2025-11-24", "2026-02-22"]);
    expect(pr.tables.flatMap((t) => t.regions).map((r) => r[2][1].find((c) => c[3])![3])).toEqual(
      expect.arrayContaining([
        "For the three months ended February 22, 2026",
        "For the nine months ended February 22, 2026"
      ])
    );
    const fy = fixture("FY2018").period;
    expect([proof(fy).reportDate, proof(fy).originalFiscalYear]).toEqual(["2020-05-31", 2020]);
    expect(
      decodeOriginalRows([proof(fy).primary.revenue])[0]
        .cells.filter((c) => c.fact)
        .map((c) => [c.fact!.startDate, c.fact!.endDate])
    ).toContainEqual(["2019-05-27", "2020-05-31"]);
  });
  it("uses the already-net discontinued loss once and retains the tax benefit as a separate original annotation", () => {
    const p = fixture("2027-Q1").period,
      original = originalDardenInlineIncome(p, p.dardenInlineIncome!);
    expect(p.metrics.discontinuedOperationsIncome).toBe(-900000);
    expect(
      p.dardenInlineIncome!.labelNotes[0].annotations[0].originalMonetaryCell.fact!.value
    ).toBe(-300000);
    expect(
      p.metrics.pretaxIncome! - p.metrics.incomeTax! + p.metrics.discontinuedOperationsIncome!
    ).toBe(p.metrics.netIncome);
    expect(original.metrics.netIncome).toBe(p.metrics.netIncome);
    const result = buildStatementFlow(flowPeriod(p)!);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    expect(result.graph.nodes.filter((n) => n.group === "discontinued")).toHaveLength(1);
    expect(result.graph.nodes.find((n) => n.group === "discontinued")!.amount).toBe(900000);
  });
  it("retains the original negative-zero annotations and withholds an unreviewed older income ledger", () => {
    const s = fixture("2023-Q1");
    expect(s.html).toContain(
      'name="us-gaap:DiscontinuedOperationTaxEffectOfDiscontinuedOperation"'
    );
    expect(businessPeriod(s.period)).toBeDefined();
    expect(s.period.dardenInlineIncome).toBeUndefined();
    expect(flowPeriod(s.period)).toBeUndefined();
    expect(s.period.metrics).toEqual(s.retained.metrics);
    expect(s.period.metricSources).toEqual(s.retained.metricSources);
  });
  const businessMutations: [string, (p: PeriodV2) => void][] = [
    [
      "unknown encoding",
      (p) => {
        proof(p).encoding = "foreign" as never;
      }
    ],
    [
      "missing comparative region",
      (p) => {
        proof(p).tables.pop();
      }
    ],
    [
      "duplicate scope",
      (p) => {
        proof(p).tables[0].regions.push(structuredClone(proof(p).tables[0].regions[0]));
        proof(p).tables[0].sourceSalesRows.push(proof(p).tables[0].sourceSalesRows[0]);
      }
    ],
    [
      "changed original period caption",
      (p) => {
        proof(p).tables[0].regions[0][2][1].find((c) => c[3])![3] =
          "For the six months ended August 30, 2026";
      }
    ],
    [
      "changed physical span",
      (p) => {
        firstMoney(p)[1]++;
      }
    ],
    [
      "missing monetary declaration",
      (p) => {
        firstMoney(p).pop();
      }
    ],
    [
      "unaccounted untagged amount",
      (p) => {
        proof(p).tables[0].regions[0][3][1].find((c) => c.length === 4 && c[3] === "")![3] =
          "123.4";
      }
    ],
    [
      "extra geography",
      (p) => {
        firstMoney(p)[4]!.dimensions["srt:GeographicalAreasAxis"] = "dri:USA";
      }
    ],
    [
      "changed brand classification",
      (p) => {
        firstMoney(p)[4]!.dimensions["us-gaap:StatementBusinessSegmentsAxis"] = "dri:UnknownMember";
      }
    ],
    [
      "changed tag",
      (p) => {
        firstMoney(p)[4]!.tag = "us-gaap:OperatingIncomeLoss";
      }
    ],
    [
      "changed visible and parsed amount",
      (p) => {
        changeAmount(firstMoney(p));
      }
    ],
    [
      "changed display scale",
      (p) => {
        firstMoney(p)[4]!.declarations[0].scale = 3;
      }
    ],
    [
      "changed currency",
      (p) => {
        firstMoney(p)[4]!.currency = "EUR" as never;
      }
    ],
    [
      "changed precision",
      (p) => {
        firstMoney(p)[4]!.decimals = -3;
      }
    ],
    [
      "Corporate invented nonzero",
      (p) => {
        const c = proof(p).tables[0].regions[0][3][1].filter((c) => c[4])[4];
        c[3] = "1";
        c[4]!.value = 1000000;
        c[4]!.declarations[0].format = "";
      }
    ],
    [
      "Corporate untagged zero",
      (p) => {
        proof(p)
          .tables[0].regions[0][3][1].filter((c) => c[4])[4]
          .pop();
      }
    ],
    [
      "changed retained revenue",
      (p) => {
        p.metrics.revenue!++;
      }
    ],
    [
      "changed retained tax",
      (p) => {
        p.metrics.incomeTax!++;
      }
    ],
    [
      "foreign source",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("www.sec.gov", "example.com");
      }
    ],
    [
      "changed source focus",
      (p) => {
        proof(p).originalFiscalYear++;
      }
    ],
    [
      "missing original calendar",
      (p) => {
        proof(p).fiscalCalendar = "52 weeks";
      }
    ],
    [
      "changed independent primary",
      (p) => {
        changeAmount(proof(p).primary.revenue[1].find((c) => c[4])!);
      }
    ],
    [
      "changed original primary date",
      (p) => {
        proof(p).primary.headerRows[2][1].find((c) => c[3])![3] = "August 29, 2026";
      }
    ],
    [
      "unit rebound",
      (p) => {
        proof(p).units[0].measure = "iso4217:EUR" as never;
      }
    ],
    [
      "changed saved leaf",
      (p) => {
        p.segments![0].revenue++;
      }
    ],
    [
      "borrowed segment gross profit",
      (p) => {
        p.segments![0].grossProfit = 1;
      }
    ],
    [
      "mixed proof",
      (p) => {
        p.businessBreakdownSource!.cencoraRevenue = {} as never;
      }
    ]
  ];
  for (const [name, mutate] of businessMutations)
    it(`withholds the entire business partition for ${name}`, () => {
      const s = fixture("2027-Q1"),
        p = structuredClone(s.period);
      mutate(p);
      expect(dardenRevenueProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
      expect(flowPeriod(p)).toBeUndefined();
      expect(() => validateV2(companyFromFilingPeriods(s.identity, [p]))).toThrow();
    });
  const incomeMutations: [string, (p: PeriodV2) => void][] = [
    [
      "primary table disagrees with business source",
      (p) => {
        p.dardenInlineIncome!.tableIndex++;
      }
    ],
    [
      "original income header differs from business header",
      (p) => {
        p.dardenInlineIncome!.rows[0][1][0][3] = "Changed note";
      }
    ],
    [
      "untagged primary amount",
      (p) => {
        p.dardenInlineIncome!.rows[5][1].find((c) => c.length === 4 && c[3] === "")![3] = "123";
      }
    ],
    [
      "changed original tax-note tag",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].annotations[0].originalMonetaryCell.fact!.tag =
          "us-gaap:IncomeTaxExpenseBenefit";
      }
    ],

    [
      "missing complete primary row",
      (p) => {
        p.dardenInlineIncome!.rows.splice(5, 1);
      }
    ],
    [
      "missing comparative monetary cell",
      (p) => {
        p.dardenInlineIncome!.rows[5][1].filter((c) => c[4])[1].pop();
      }
    ],
    [
      "unknown cost meaning",
      (p) => {
        p.dardenInlineIncome!.rows[5][1][0][3] = "New expenses";
      }
    ],
    [
      "cost incorrectly classified",
      (p) => {
        p.dardenInlineIncome!.rows[5][1].find((c) => c[4])![4]!.dimensions = {};
      }
    ],
    [
      "cost changed visibly and numerically",
      (p) => {
        changeAmount(p.dardenInlineIncome!.rows[5][1].find((c) => c[4])!);
      }
    ],
    [
      "missing monetary note",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].annotations.pop();
      }
    ],
    [
      "original raw note changed",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].originalLabelCell =
          p.dardenInlineIncome!.labelNotes[0].originalLabelCell.replace("0.3", "0.7");
      }
    ],
    [
      "raw declaration changed",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].annotations[0].originalDeclaration += " ";
      }
    ],
    [
      "changed tax-note scope",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].annotations[0].originalMonetaryCell.fact!.startDate =
          "2026-05-31";
      }
    ],
    [
      "changed note magnitude",
      (p) => {
        p.dardenInlineIncome!.labelNotes[0].annotations[0].originalMonetaryCell.fact!.value =
          -800000;
      }
    ],
    [
      "changed discontinued fact",
      (p) => {
        p.metrics.discontinuedOperationsIncome = -1200000;
      }
    ],
    [
      "duplicate tax deduction",
      (p) => {
        p.metrics.netIncome! -= 300000;
      }
    ],
    [
      "foreign income proof",
      (p) => {
        p.dardenInlineIncome!.ruleId = "foreign" as never;
      }
    ],
    [
      "unknown proof field",
      (p) => {
        (p.dardenInlineIncome as unknown as Record<string, unknown>).inventedAmount = 1;
      }
    ],
    [
      "competing signed ledger",
      (p) => {
        p.operatingItems = {} as never;
      }
    ],
    [
      "changed discontinued attribution",
      (p) => {
        p.metricSources.discontinuedOperationsIncome!.label = "Pretax loss";
      }
    ]
  ];
  for (const [name, mutate] of incomeMutations)
    it(`withholds the complete financial flow for ${name}`, () => {
      const s = fixture("2027-Q1"),
        p = structuredClone(s.period);
      mutate(p);
      expect(dardenInlineIncomeProblem(p)).toBeDefined();
      expect(flowPeriod(p)).toBeUndefined();
      expect(buildStatementFlow(p as never).ok).toBe(false);
      expect(() => validateV2(companyFromFilingPeriods(s.identity, [p]))).toThrow();
    });
  it("withholds a changed original business classification without a generic fallback", () => {
    const s = fixture("2027-Q1"),
      html = s.html.replaceAll("Olive Garden", "Unknown chain"),
      out = readGenericFiling(html, s.identity, s.source.filing, undefined, []);
    expect(out.every((p) => !p.coverage.segments)).toBe(true);
  });
  it("rejects unknown coordinate fields instead of losing source evidence during encoding", () => {
    expect(() =>
      encodeOriginalRows([
        {
          rowIndex: 0,
          cells: [
            { columnIndex: 0, span: 1, rowSpan: 1, label: "", originalUnknown: "kept" } as never
          ]
        }
      ])
    ).toThrow(/discarded/);
    expect(() => decodeOriginalRows([[0, [[0, 1, 1, "", null as never]]]])).toThrow();
  });
});
