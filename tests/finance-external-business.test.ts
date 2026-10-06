import { describe, expect, it } from "vitest";
import { enrichMatrixBusinessPeriods } from "../scripts/finance/business-matrix";
import { enrichReviewedBusinessPeriods } from "../scripts/finance/reviewed-business";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { sourceLabel } from "../src/features/finance/business-rules";
import { visibleText } from "../scripts/finance/business-v2";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";
import { readGenericFiling } from "../scripts/finance/generic-import";

const externalRow = (html: string, label: string, change: (row: string) => string) =>
  html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) =>
    sourceLabel(visibleText(row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? "")) === label
      ? change(row)
      : row
  );

describe("original external-customer revenue partitions", () => {
  it.each([
    "APHExternalAnnual",
    "APHExternalQuarterly",
    "IEXExternalAnnual",
    "IEXExternalQuarterly"
  ] as const)("%s recovers original business amounts on an empty first import", (key) => {
    const f = reviewedFixture(key);
    const first = readGenericFiling(f.html, f.identity, f.filing, undefined).find(
      (p) => p.id === f.period.id
    );
    expect(first?.coverage).toEqual({ basics: true, segments: true, sankey: true });
    expect(first?.segments).toEqual(f.period.segments);
    expect(first?.metrics.revenue).toBe(f.period.metrics.revenue);
    expect(first?.metricSources.revenue?.tag).toBe(f.period.metricSources.revenue?.tag);
  });
  it.each(["APHExternalAnnual", "APHExternalQuarterly"] as const)(
    "reads %s external net sales instead of gross/internal sales",
    (key) => {
      const f = reviewedFixture(key);
      expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual(
        key === "APHExternalAnnual"
          ? [
              ["Communications Solutions", 12056e6],
              ["Harsh Environment Solutions", 5881.7e6],
              ["Interconnect and Sensor Systems", 5157e6]
            ]
          : [
              ["Communications Solutions", 5383.6e6],
              ["Harsh Environment Solutions", 1856.8e6],
              ["Interconnect and Sensor Systems", 1517.7e6]
            ]
      );
      expect(f.period.businessBreakdownSource).toMatchObject({
        method: "statement-revenue-matrix",
        layout: "columns",
        rowIndex: 5,
        qualifiers: {},
        totalDimensions: {},
        revenue: f.period.metrics.revenue
      });
      expect(f.period.revenueAdjustments).toBeUndefined();
      expect(businessPeriod(f.period)).toBeDefined();
      expect(flowPeriod(f.period)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
      const read = (html: string) =>
        enrichMatrixBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
      for (const source of [
        externalRow(f.html, "External net sales", () => ""),
        externalRow(f.html, "External net sales", (row) =>
          row.replaceAll('contextRef="', 'contextRef="missing-')
        ),
        f.html.replaceAll("us-gaap:StatementBusinessSegmentsAxis", "srt:StatementGeographicalAxis"),
        externalRow(f.html, "External net sales", (row) =>
          row.replace(/>12,056.0<|>5,383.6</, ">99,999.0<")
        )
      ])
        expect(read(source)).toEqual([]);
    }
  );

  it.each(["IEXExternalAnnual", "IEXExternalQuarterly"] as const)(
    "reads every %s external-sales column and counts duplicate totals once",
    (key) => {
      const f = reviewedFixture(key);
      expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual(
        key === "IEXExternalAnnual"
          ? [
              ["Health & Science Technologies", 1490.7e6],
              ["Fluid & Metering Technologies", 1222.5e6],
              ["Fire & Safety/Diversified Products", 744.3e6]
            ]
          : [
              ["Health & Science Technologies", 414e6],
              ["Fluid & Metering Technologies", 316.7e6],
              ["Fire & Safety/Diversified Products", 189.9e6]
            ]
      );
      expect(f.period.businessBreakdownSource).toMatchObject({
        method: "reviewed-segment-table",
        ruleId: "iex-external-customers-columns-v1",
        tableIndex: 1,
        totalTableIndex: 0,
        totalLabel: "External customers",
        externalCustomerColumns: {
          totals: [
            {
              label: "Total Segments",
              value: f.period.metrics.revenue,
              dimensions: {},
              columnIndex: 22
            },
            { label: "IDEX", value: f.period.metrics.revenue, dimensions: {}, columnIndex: 34 }
          ],
          blanks: [{ label: "Eliminations", columnIndex: 27 }]
        }
      });
      expect(f.period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(
        f.period.metrics.revenue
      );
      expect(f.period.revenueAdjustments).toBeUndefined();
      expect(businessPeriod(f.period)).toBeDefined();
      expect(flowPeriod(f.period)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
    }
  );

  it("withholds IDEX when external rows, headers, original totals or the independent primary total change", () => {
    const f = reviewedFixture("IEXExternalQuarterly");
    const read = (html: string) =>
      enrichReviewedBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
    const withoutPrimary = f.html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/i, "");
    const invalid = [
      withoutPrimary,
      externalRow(f.html, "External customers", () => ""),
      externalRow(f.html, "External customers", (row) =>
        row.replaceAll('contextRef="', 'contextRef="unresolved-')
      ),
      externalRow(f.html, "External customers", (row) =>
        row.replaceAll('unitRef="', 'unitRef="unresolved-')
      ),
      externalRow(f.html, "External customers", (row) =>
        row.replaceAll('name="us-gaap:Revenues"', 'name="iex:UnreviewedSales"')
      ),
      externalRow(f.html, "External customers", (row) => row.replaceAll(">414.0<", ">415.0<")),
      f.html.replaceAll("iex:HealthAndScienceTechnologiesMember", "iex:UnreviewedNewSegmentMember"),
      f.html.replaceAll(">HST<", ">New segment<"),
      f.html.replaceAll(">Total Segments<", ">Unknown aggregate<"),
      f.html.replaceAll(">IDEX<", ">Unknown total<"),
      f.html.replaceAll(">Eliminations<", ">New business<")
    ];
    for (const source of invalid) expect(read(source)).toEqual([]);
    // Gross/internal rows still exist in every case except the primary-table removal.
    expect(withoutPrimary).toContain("Intersegment sales");
    const wrongScope = structuredClone(f.basic);
    wrongScope.metricSources.revenue!.tag =
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
    expect(
      enrichReviewedBusinessPeriods(
        f.html,
        f.identity,
        f.filing,
        [wrongScope],
        parseInlineXbrl(f.html)
      )
    ).toEqual([]);
  });

  it("rejects stored external-sales proofs with incomplete columns, wrong coordinates, scopes or provenance", () => {
    const f = reviewedFixture("IEXExternalAnnual");
    const mutations: ((period: PeriodV2) => void)[] = [
      (p) => {
        delete p.businessBreakdownSource!.externalCustomerColumns;
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.headers.pop();
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.headers[0].columnIndex = 9;
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.totals[0].value += 1;
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.totals[0].dimensions = {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        };
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.totals.pop();
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.blanks[0].columnIndex = 28;
      },
      (p) => {
        p.businessBreakdownSource!.externalCustomerColumns!.blanks.pop();
      },
      (p) => {
        p.businessBreakdownSource!.totalTableIndex = p.businessBreakdownSource!.tableIndex;
      },
      (p) => {
        p.segments![0].revenueSource!.columnIndex = 10;
      },
      (p) => {
        p.segments![0].revenueSource!.rowIndex! += 1;
      },
      (p) => {
        p.segments![0].revenueSource!.dimensions["srt:ConsolidationItemsAxis"] =
          "us-gaap:OperatingSegmentsMember";
      },
      (p) => {
        p.segments![0].revenueSource!.endDate = "2024-12-31";
      },
      (p) => {
        p.metricSources.revenue!.accession = "unrelated-filing";
      }
    ];
    for (const mutate of mutations) {
      const period = structuredClone(f.period);
      mutate(period);
      expect(businessPeriod(period)).toBeUndefined();
      expect(flowPeriod(period)).toBeUndefined();
    }
  });
});
