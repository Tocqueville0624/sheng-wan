import { describe, expect, it } from "vitest";
import { enrichMatrixBusinessPeriods } from "../scripts/finance/business-matrix";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
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
    // Revenue partitioning does not turn the reported operating loss into a profit.
    expect(period.metrics.operatingIncome).toBe(-2097.1e6);
    expect(period.coverage.sankey).toBe(false);
    expect(flowPeriod(period)).toBeUndefined();
    expect(enrich(fixture.html, period)).toEqual([]);
  });

  it("rejects omitted branches, conflicting copies, misplaced totals and scope changes", () => {
    for (const html of [
      fixture.html.replace(">1,670.9<", ">1,671.9<"),
      fixture.html.replace(
        /<ix:nonFraction\b(?=[^>]*contextRef="c-138")(?=[^>]*name="us-gaap:Revenues")[^>]*>/g,
        (tag) => tag.replace('name="us-gaap:Revenues"', 'name="test:MissingBranch"')
      ),
      fixture.html.replaceAll("srt:ProductOrServiceAxis", "srt:GeographicalAxis"),
      fixture.html.replaceAll("us-gaap:OperatingSegmentsMember", "us-gaap:ParentCompanyMember"),
      fixture.html.replaceAll("2026-04-01", "2026-03-01"),
      // A copy at identical precision must agree even if outside the visible table.
      fixture.html +
        '<ix:nonFraction name="us-gaap:Revenues" contextRef="c-138" unitRef="usd" decimals="-5" scale="6">1671</ix:nonFraction>'
    ])
      expect(enrich(html)).toEqual([]);
    const shifted = fixture.html.replace(
      /(<td\b[^>]*>)(?=[\s\S]{0,300}<ix:nonFraction\b[^>]*contextRef="c-138")/,
      '<td colspan="2">'
    );
    expect(shifted).not.toBe(fixture.html);
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
