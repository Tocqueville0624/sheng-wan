import { describe, expect, it } from "vitest";
import { enrichMatrixBusinessPeriods } from "../scripts/finance/business-matrix";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import {
  businessPeriod,
  flowPeriod,
  normalizeBasicPeriod,
  validateV2
} from "../scripts/finance/v2-model";
import { visibleText } from "../scripts/finance/business-v2";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

const fixture = reviewedFixture("APD");
const enrich = (html = fixture.html, period = fixture.basic) =>
  enrichMatrixBusinessPeriods(
    html,
    fixture.identity,
    fixture.filing,
    [period],
    parseInlineXbrl(html)
  );

describe("business revenue matrix source totals", () => {
  it("reads AOS annual external sales and records its reported zero corporate column", () => {
    const f = reviewedFixture("AOSAnnual");
    expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["North America", 2964.4e6],
      ["Rest of World", 865.8e6]
    ]);
    expect(f.period.businessBreakdownSource).toMatchObject({
      layout: "columns",
      tableIndex: 1,
      totalTableIndex: 0,
      rowIndex: 3,
      omittedSubtotals: [{ label: "Total Segments", value: 3830.2e6, columnIndex: 22 }],
      omittedZeroColumns: [{ label: "Less: Corporate Expenses", value: 0, columnIndex: 28 }]
    });
    // The intersegment dash has no inline fact; it is not manufactured as a zero.
    expect(f.period.businessBreakdownSource!.omittedZeroColumns).toHaveLength(1);
    expect(businessPeriod(f.period)).toBeDefined();
    expect(flowPeriod(f.period)).toBeUndefined();
    expect(() => validateV2(f.company)).not.toThrow();
  });

  it("withholds AOS annual partitions when the corporate fact or subtotal cannot be verified", () => {
    const f = reviewedFixture("AOSAnnual");
    const read = (html: string) =>
      enrichMatrixBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
    for (const html of [
      f.html.replaceAll("Less: Corporate", "Less: Unexplained"),
      f.html.replaceAll("us-gaap:CorporateNonSegmentMember", "us-gaap:ParentCompanyMember"),
      f.html.replaceAll(">2,964.4<", ">2,974.4<"),
      f.html.replaceAll('format="ixt:fixed-zero"', 'format="ixt:unknown-format"')
    ])
      expect(read(html)).toEqual([]);
    for (const change of [
      (p: PeriodV2) => {
        Object.assign(p.businessBreakdownSource!.omittedZeroColumns![0], { value: 1 });
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedZeroColumns![0].label = "Some item";
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedZeroColumns![0].dimensions = {};
      }
    ]) {
      const next = structuredClone(f.period);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });

  it("reads AOS external sales once and corroborates its dimensioned subtotal with the primary statement", () => {
    const f = reviewedFixture("AOS");
    expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["North America", 816.3e6],
      ["Rest of World", 188e6]
    ]);
    expect(f.period.businessBreakdownSource).toMatchObject({
      layout: "columns",
      tableIndex: 1,
      totalTableIndex: 0,
      rowIndex: 3,
      totalDimensions: { "us-gaap:StatementBusinessSegmentsAxis": "aos:ReportableSegmentsMember" },
      omittedSubtotals: [{ label: "Total Segments", value: 1004.3e6, columnIndex: 22 }],
      omittedZeroColumns: [{ label: "Corporate Expenses", value: 0, columnIndex: 28 }]
    });
    expect(f.period.segments!.reduce((sum, s) => sum + s.revenue, 0)).toBe(
      f.period.metrics.revenue
    );
    expect(f.period.revenueAdjustments).toBeUndefined();
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
  });

  it("rejects AOS gross internal sales, absent consolidated corroboration and wrong source scopes", () => {
    const f = reviewedFixture("AOS");
    const tables = [...f.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
    const read = (html: string) =>
      enrichMatrixBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
    for (const html of [
      f.html.replace(tables[0][0], ""),
      f.html.replaceAll(">816.3<", ">820.5<"),
      f.html.replaceAll(">1,004.3<", ">1,009.3<"),
      f.html.replaceAll("us-gaap:CorporateNonSegmentMember", "us-gaap:ParentCompanyMember"),
      f.html.replaceAll("North America", "Total North America"),
      f.html.replaceAll("us-gaap:StatementBusinessSegmentsAxis", "srt:StatementGeographicalAxis")
    ])
      expect(read(html)).toEqual([]);
  });

  it("revalidates source subtotals, explicit zero columns and independent total coordinates", () => {
    const f = reviewedFixture("AOS");
    for (const change of [
      (p: PeriodV2) => {
        delete p.businessBreakdownSource!.totalTableIndex;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.totalTableIndex = p.businessBreakdownSource!.tableIndex;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedSubtotals[0].value += 1e6;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedSubtotals[0].columnIndex =
          p.segments![0].revenueSource!.columnIndex;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedZeroColumns![0].columnIndex =
          p.segments![1].revenueSource!.columnIndex!;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedZeroColumns![0].dimensions = {};
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.totalDimensions = p.segments![0].revenueSource!.dimensions;
      }
    ]) {
      const next = structuredClone(f.period);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });

  it("retains DOV's five reported business amounts and its explicit negative intersegment elimination", () => {
    const f = reviewedFixture("DOV");
    expect(f.period.segments?.map((s) => s.revenue)).toEqual([
      283481000, 594959000, 305101000, 552709000, 455097000
    ]);
    expect(f.period.segments!.reduce((sum, s) => sum + s.revenue, 0)).toBe(2191347000);
    expect(f.period.businessBreakdownSource).toMatchObject({
      tableIndex: 1,
      rowIndex: 11,
      columnIndex: 4,
      omittedSubtotals: [{ label: "Total segment revenues", value: 2191347000, rowIndex: 9 }]
    });
    expect(f.period.revenueAdjustments).toMatchObject([
      {
        label: "Intersegment eliminations",
        revenue: -1326000,
        revenueSource: {
          value: -1326000,
          rowIndex: 10,
          columnIndex: 4,
          dimensions: { "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember" }
        }
      }
    ]);
    expect(f.period.metrics.revenue).toBe(2190021000);
    expect(businessPeriod(f.period)).toBeDefined();
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
  });

  it("withholds DOV partitions when an elimination or subtotal is missing or contradicts its branches", () => {
    const f = reviewedFixture("DOV");
    const read = (html: string) =>
      enrichMatrixBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
    for (const html of [
      f.html.replaceAll(">1,326<", ">1,426<"),
      f.html.replaceAll(">2,191,347<", ">2,199,347<"),
      f.html.replaceAll("us-gaap:IntersegmentEliminationMember", "us-gaap:ParentCompanyMember"),
      f.html.replaceAll("Total segment revenues", "Unexplained reconciliation"),
      f.html.replaceAll("Intersegment eliminations", "Some adjustment"),
      f.html.replaceAll(">283,481<", ">281,481<")
    ])
      expect(read(html)).toEqual([]);
  });

  it("refuses an invented or misplaced adjustment in a saved DOV partition", () => {
    const f = reviewedFixture("DOV");
    for (const change of [
      (p: PeriodV2) => {
        delete p.revenueAdjustments![0].revenueSource;
      },
      (p: PeriodV2) => {
        p.revenueAdjustments![0].revenueSource!.dimensions = {};
      },
      (p: PeriodV2) => {
        p.revenueAdjustments![0].revenueSource!.rowIndex = p.businessBreakdownSource!.rowIndex;
      },
      (p: PeriodV2) => {
        p.revenueAdjustments![0].revenueSource!.columnIndex! += 1;
      },
      (p: PeriodV2) => {
        p.revenueAdjustments![0].revenueSource!.startDate = "2026-01-01";
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedSubtotals = [];
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.omittedSubtotals[0].value += 1e6;
      },
      (p: PeriodV2) => {
        p.segments![0].revenueSource!.rowIndex =
          p.businessBreakdownSource!.omittedSubtotals[0].rowIndex;
      }
    ]) {
      const next = structuredClone(f.period);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });

  it("aligns DHR's operating-segment captions with its complete row of source totals", () => {
    const f = reviewedFixture("DHR");
    expect(f.period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Biotechnology", 1920e6],
      ["Life Sciences", 1879e6],
      ["Diagnostics", 2466e6]
    ]);
    expect(f.period.businessBreakdownSource).toMatchObject({
      layout: "columns",
      tableIndex: 1,
      headerRowIndex: 1,
      rowIndex: 8,
      axis: "us-gaap:StatementBusinessSegmentsAxis",
      columnIndex: 22
    });
    expect(f.period.segments?.map((s) => s.revenueSource!.columnIndex)).toEqual([4, 10, 16]);
    expect(f.period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(6265e6);
    expect(flowPeriod(f.period)).toBeDefined();
    expect(() => validateV2(f.company)).not.toThrow();
  });

  it("withholds incomplete, contradictory or misaligned source column partitions", () => {
    const f = reviewedFixture("DHR");
    const read = (html: string) =>
      enrichMatrixBusinessPeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html));
    const misaligned = f.html.replace(/<td\b[^>]*\/>|<td\b[^>]*>[\s\S]*?<\/td>/gi, (cell) =>
      visibleText(cell) === "Biotechnology" ? cell.replace('colspan="3"', 'colspan="5"') : cell
    );
    expect(misaligned).not.toBe(f.html);
    for (const html of [
      misaligned,
      f.html.replaceAll("Life Sciences", "Biotechnology"),
      f.html.replaceAll(">1,920<", ">1,925<"),
      f.html.replaceAll("us-gaap:OperatingSegmentsMember", "us-gaap:ParentCompanyMember"),
      f.html.replaceAll("us-gaap:StatementBusinessSegmentsAxis", "srt:StatementGeographicalAxis"),
      f.html.replaceAll("2026-03-28", "2026-03-01")
    ])
      expect(read(html)).toEqual([]);
    for (const change of [
      (p: PeriodV2) => {
        p.businessBreakdownSource!.headerRowIndex = p.businessBreakdownSource!.rowIndex;
      },
      (p: PeriodV2) => {
        p.segments![0].revenueSource!.columnIndex = p.businessBreakdownSource!.columnIndex;
      },
      (p: PeriodV2) => {
        p.segments![0].revenueSource!.columnIndex = p.segments![1].revenueSource!.columnIndex;
      }
    ]) {
      const next = structuredClone(f.period);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });

  it("removes a previously saved contract-timing split while preserving reported financial values", () => {
    const f = reviewedFixture("DHR");
    const previous = structuredClone(f.period);
    const parsed = parseInlineXbrl(f.html);
    previous.segments = ["c-115", "c-119"].map((context, i) => {
      const fact = parsed.facts.find(
        (f) => f.context.id === context && f.tag === previous.metricSources.revenue!.tag
      )!;
      const label = i ? "Nonrecurring" : "Recurring";
      return {
        id: `timing-${context}`,
        label,
        revenue: fact.value,
        revenueSource: {
          sourceUrl: previous.sourceUrl,
          accession: previous.accession!,
          filedAt: previous.filedAt,
          startDate: previous.startDate,
          endDate: previous.endDate,
          currency: fact.currency,
          tag: fact.tag,
          dimensions: fact.context.dimensions,
          value: fact.value,
          decimals: fact.decimals,
          tableLabel: label
        }
      };
    });
    previous.businessBreakdownSource = {
      ...previous.businessBreakdownSource!,
      layout: undefined,
      axis: "srt:ProductOrServiceAxis",
      qualifiers: {},
      headerRowIndex: undefined,
      rowIndex: undefined
    };
    const before = structuredClone(previous);
    expect(businessPeriod(previous)).toBeUndefined();
    const repaired = normalizeBasicPeriod(previous);
    expect(repaired.segments).toBeUndefined();
    expect(repaired.coverage.segments).toBe(false);
    expect(repaired.businessBreakdownSource).toBeUndefined();
    for (const metric of ["revenue", "operatingIncome", "netIncome"] as const)
      expect(repaired.metrics[metric]).toBe(previous.metrics[metric]);
    expect(previous).toEqual(before);
  });

  it("can use APD's independently reconciled operating segments when the product partition is unavailable", () => {
    const html = fixture.html.replaceAll(
      "srt:ProductOrServiceAxis",
      "srt:StatementGeographicalAxis"
    );
    const [p] = enrich(html);
    expect(p.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Americas", 1321.4e6],
      ["Asia", 886e6],
      ["Europe", 815.7e6],
      ["Middle East and India", 34.8e6],
      ["Corporate and other", 103.1e6]
    ]);
    expect(p.businessBreakdownSource?.axis).toBe("us-gaap:StatementBusinessSegmentsAxis");
    expect(p.coverage.sankey).toBe(false);
  });
  it("reads APD's product totals without adding the intersecting regional revenues", () => {
    const { period } = fixture;
    expect(period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["On-site", 1670.9e6],
      ["Merchant", 1387e6],
      ["Sale of equipment", 103.1e6]
    ]);
    expect(period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(3161e6);
    expect(period.businessBreakdownSource?.method).toBe("statement-revenue-matrix");
    expect(period.businessBreakdownSource?.axis).toBe("srt:ProductOrServiceAxis");
    expect(period.businessBreakdownSource?.qualifiers).toEqual({
      "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
    });
    expect(period.businessBreakdownSource?.tableIndex).toBe(1);
    expect(businessPeriod(period)).toBeDefined();
    expect(() => validateV2(fixture.company)).not.toThrow();
    // The independent source-reviewed operating ledger preserves the loss.
    expect(period.metrics.operatingIncome).toBe(-2097.1e6);
    expect(period.coverage.sankey).toBe(true);
    expect(period.operatingItems?.ruleId).toBe("apd-operating-items-v1");
    expect(flowPeriod(period)?.metrics.operatingIncome).toBe(-2097.1e6);
    expect(enrich(fixture.html, period)).toEqual([]);
  });

  it("rejects corrupt product totals when no independent business classification is available", () => {
    // Synthetic rejection mutations suppress the separately valid regional
    // operating-segment totals; positive acceptance still uses the raw source.
    const productsOnly = fixture.html.replaceAll(
      "us-gaap:StatementBusinessSegmentsAxis",
      "srt:StatementGeographicalAxis"
    );
    for (const html of [
      productsOnly.replace(">1,670.9<", ">1,671.9<"),
      productsOnly.replace(
        /<ix:nonFraction\b(?=[^>]*contextRef="c-138")(?=[^>]*name="us-gaap:Revenues")[^>]*>/g,
        (tag) => tag.replace('name="us-gaap:Revenues"', 'name="test:MissingBranch"')
      ),
      productsOnly.replaceAll("srt:ProductOrServiceAxis", "srt:GeographicalAxis"),
      productsOnly.replaceAll("us-gaap:OperatingSegmentsMember", "us-gaap:ParentCompanyMember"),
      productsOnly.replaceAll("2026-04-01", "2026-03-01"),
      // A copy at identical precision must agree even if outside the visible table.
      productsOnly +
        '<ix:nonFraction name="us-gaap:Revenues" contextRef="c-138" unitRef="usd" decimals="-5" scale="6">1671</ix:nonFraction>'
    ])
      expect(enrich(html)).toEqual([]);
    const shifted = productsOnly.replace(
      /(<td\b[^>]*>)(?=[\s\S]{0,300}<ix:nonFraction\b[^>]*contextRef="c-138")/,
      '<td colspan="2">'
    );
    expect(shifted).not.toBe(productsOnly);
    expect(enrich(shifted)).toEqual([]);
  });

  it("refuses a total from another table and a nonconsolidated revenue base", () => {
    const absent = fixture.html.replace(
      /<ix:nonFraction\b(?=[^>]*contextRef="c-156")(?=[^>]*name="us-gaap:Revenues")[^>]*>/g,
      (tag) => tag.replace('name="us-gaap:Revenues"', 'name="test:MissingTotal"')
    );
    expect(absent).not.toBe(fixture.html);
    expect(enrich(absent)).toEqual([]);
    expect(enrich(fixture.html, { ...fixture.basic, metrics: { revenue: 3022.7e6 } })).toEqual([]);
    expect(enrich(fixture.html, { ...fixture.basic, reportingCurrency: "TWD" })).toEqual([]);
  });

  it("checks issuer identity and revalidates matrix proof on later reads", () => {
    expect(() => enrich(fixture.html.replaceAll("0000002969", "0000200406"))).toThrow(/identity/);
    for (const change of [
      (p: PeriodV2) => {
        delete p.businessBreakdownSource!.qualifiers;
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.qualifiers = { "srt:GeographicalAxis": "test:RegionMember" };
      },
      (p: PeriodV2) => {
        p.businessBreakdownSource!.columnIndex = -1;
      },
      (p: PeriodV2) => {
        p.segments![0].revenueSource!.dimensions["test:OtherAxis"] = "test:OtherMember";
      },
      (p: PeriodV2) => {
        p.segments![0].revenueSource!.tag = "test:UnrelatedRevenue";
      }
    ]) {
      const next = structuredClone(fixture.period);
      change(next);
      expect(businessPeriod(next)).toBeUndefined();
    }
  });

  it("does not bypass a registered issuer's reviewed business schema", () => {
    const f = reviewedFixture("JNJ");
    expect(
      enrichMatrixBusinessPeriods(f.html, f.identity, f.filing, [f.basic], parseInlineXbrl(f.html))
    ).toEqual([]);
  });
});
