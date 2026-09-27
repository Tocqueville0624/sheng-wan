import { describe, expect, it } from "vitest";
import { businessFixture } from "./fixtures/finance/business-fixtures";
import { enrichBusinessPeriods } from "../scripts/finance/business-v2";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { buildStatementFlow } from "../src/features/finance/chart-model";
import type { PeriodV2 } from "../src/features/finance/v2-types";

const fixtures = {
  MCD: businessFixture("MCD"),
  TSLA: businessFixture("TSLA"),
  IBM: businessFixture("IBM")
};

// Deliberately synthetic, tiny statements isolate rejection rules. The positive
// issuer acceptance cases above always use preserved real filing fragments.
function synthetic(
  options: {
    axis?: string;
    typed?: boolean;
    rowContext?: string;
    extra?: string;
    decimals?: string;
    amounts?: [number, number, number];
    totalLabel?: string;
    tag?: string;
  } = {}
) {
  const { identity, filing } = fixtures.MCD;
  const [a, b, total] = options.amounts ?? [60, 40, 100];
  const tag = options.tag ?? "us-gaap:Revenues";
  const context = (id: string, dimensions = "") =>
    `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${identity.cik}</xbrli:identifier>${dimensions ? `<xbrli:segment>${dimensions}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>`;
  const dimension = (member: string) =>
    options.typed
      ? `<xbrldi:typedMember dimension="srt:GeographicalAxis"><test:Region>${member}</test:Region></xbrldi:typedMember>`
      : options.axis
        ? `<xbrldi:explicitMember dimension="${options.axis}">test:${member}Member</xbrldi:explicitMember>`
        : "";
  const fact = (name: string, value: number, ctx: string) =>
    `<ix:nonFraction name="${name}" contextRef="${ctx}" unitRef="USD" decimals="${options.decimals ?? "0"}">${value}</ix:nonFraction>`;
  const row = (label: string, f: string) => `<tr><td>${label}</td><td>${f}</td></tr>`;
  const html =
    context("c0") +
    context("ca", dimension("A")) +
    context("cb", dimension("B")) +
    '<xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>' +
    (options.extra ?? "") +
    `<table>${row("Product A", fact("test:RevenueA", a, options.rowContext ?? "ca"))}${row("Product B", fact("test:RevenueB", b, options.rowContext ?? "cb"))}${row(options.totalLabel ?? "Total revenues", fact(tag, total, "c0"))}</table>`;
  const period: PeriodV2 = {
    ...fixtures.MCD.basic,
    metrics: { revenue: total },
    metricSources: { revenue: { ...fixtures.MCD.basic.metricSources.revenue!, tag } },
    coverage: { basics: true, segments: false, sankey: false }
  };
  return { html, identity, filing, period, fact };
}

describe("source-grounded generic business revenue", () => {
  it("uses MCD's complete reported revenue rows and keeps the one-million source rounding explicit", () => {
    const { period, company } = fixtures.MCD;
    expect(period.segments?.map((s) => [s.label, s.revenue])).toEqual([
      ["Revenues from franchised restaurants", 4393e6],
      ["Sales by Company-owned and operated restaurants", 2525e6],
      ["Other revenues", 182e6]
    ]);
    expect(period.revenueAdjustments).toEqual([
      { id: "source-rounding", label: "Source rounding", revenue: -1e6 }
    ]);
    expect(period.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(7100e6);
    expect(period.metrics.revenue).toBe(7099e6);
    expect(period.segments?.every((s) => s.grossProfit === undefined)).toBe(true);
    expect(businessPeriod(period)).toBeDefined();
    expect(flowPeriod(period)).toBeDefined();
    expect(buildStatementFlow(flowPeriod(period)!).ok).toBe(true);
    expect(() => validateV2(company)).not.toThrow();
  });

  it("uses TSLA's five leaf rows and excludes the independently checked automotive subtotal", () => {
    const { period, consolidated, company, html, identity, filing } = fixtures.TSLA;
    expect(consolidated.coverage.sankey).toBe(true);
    expect(consolidated.coverage.segments).toBe(false);
    expect(enrichBusinessPeriods(html, identity, filing, [consolidated])).toHaveLength(1);
    expect(period.segments?.map((s) => s.revenue)).toEqual([20006e6, 146e6, 364e6, 3139e6, 4581e6]);
    expect(period.segments?.map((s) => s.grossProfit)).toEqual([
      3140e6,
      undefined,
      177e6,
      640e6,
      648e6
    ]);
    expect(period.businessBreakdownSource?.omittedSubtotals).toEqual([
      expect.objectContaining({ label: "Total automotive revenues", value: 20516e6 })
    ]);
    expect(period.revenueAdjustments).toBeUndefined();
    expect(period.metrics.netIncome).toBe(1114e6);
    expect(period.metrics.noncontrollingInterestIncome).toBe(14e6);
    expect(() => validateV2(company)).not.toThrow();
  });

  it("supports a third issuer's business chart independently of a complete profit flow", () => {
    const { period, company } = fixtures.IBM;
    expect(period.segments?.map((s) => [s.label, s.revenue, s.grossProfit])).toEqual([
      ["Services", 7927e6, 2633e6],
      ["Sales", 9049e6, 7195e6],
      ["Financing", 186e6, 79e6]
    ]);
    expect(period.metrics.revenue).toBe(17162e6);
    expect(period.coverage).toEqual({ basics: true, segments: true, sankey: false });
    expect(businessPeriod(period)).toBeDefined();
    expect(flowPeriod(period)).toBeUndefined();
    expect(() => validateV2(company)).not.toThrow();
  });

  it("retains exact source identity, label, dimension, precision and amount on every branch", () => {
    for (const { period, filing } of Object.values(fixtures)) {
      for (const segment of period.segments!)
        expect(segment.revenueSource).toMatchObject({
          sourceUrl: filing.sourceUrl,
          accession: filing.accession,
          filedAt: filing.filedAt,
          startDate: "2026-04-01",
          endDate: "2026-06-30",
          currency: "USD",
          value: segment.revenue,
          tableLabel: segment.label,
          decimals: -6
        });
      expect(period.segmentSourceUrl).toBe(filing.sourceUrl);
    }
  });

  it("preserves existing reviewed or enriched breakdowns and does not mutate input", () => {
    for (const { html, identity, filing, period, consolidated } of Object.values(fixtures)) {
      const before = structuredClone(consolidated);
      enrichBusinessPeriods(html, identity, filing, [consolidated]);
      expect(consolidated).toEqual(before);
      expect(enrichBusinessPeriods(html, identity, filing, [period])).toEqual([]);
      const reviewed = { ...period, businessBreakdownSource: undefined };
      expect(enrichBusinessPeriods(html, identity, filing, [reviewed])).toEqual([]);
    }
  });

  it("recognizes a standard Net sales total without issuer-specific rules", () => {
    const f = synthetic({ totalLabel: "Total net sales", tag: "us-gaap:SalesRevenueNet" });
    expect(
      enrichBusinessPeriods(f.html, f.identity, f.filing, [f.period])[0].segments
    ).toHaveLength(2);
  });

  it("rejects issuer or filing URL mismatches", () => {
    const f = synthetic();
    expect(() =>
      enrichBusinessPeriods(f.html.replaceAll(f.identity.cik, "0000000001"), f.identity, f.filing, [
        f.period
      ])
    ).toThrow(/CIK/);
    expect(() =>
      enrichBusinessPeriods(
        f.html,
        f.identity,
        { ...f.filing, sourceUrl: f.filing.sourceUrl.replace("www.sec.gov", "example.com") },
        [f.period]
      )
    ).toThrow(/URL/);
  });

  it("rejects incomplete, negative, imprecise and materially rounded partitions", () => {
    for (const options of [
      { amounts: [60, 30, 100] as [number, number, number] },
      { amounts: [110, -10, 100] as [number, number, number] },
      { amounts: [60, 40, 101] as [number, number, number] },
      { decimals: "not-a-number" }
    ]) {
      const f = synthetic(options);
      expect(enrichBusinessPeriods(f.html, f.identity, f.filing, [f.period])).toEqual([]);
    }
  });

  it("does not merge typed geography contexts into nondimensional facts of equal value", () => {
    const f = synthetic({ typed: true });
    const hidden = f.fact("test:RevenueA", 60, "c0") + f.fact("test:RevenueB", 40, "c0");
    expect(enrichBusinessPeriods(hidden + f.html, f.identity, f.filing, [f.period])).toEqual([]);
  });

  it("rejects geography, cross axes and conflicting duplicate facts", () => {
    const geographic = synthetic({ axis: "srt:GeographicalAxis" });
    expect(
      enrichBusinessPeriods(geographic.html, geographic.identity, geographic.filing, [
        geographic.period
      ])
    ).toEqual([]);
    const f = synthetic();
    expect(
      enrichBusinessPeriods(f.fact("test:RevenueA", 59, "ca") + f.html, f.identity, f.filing, [
        f.period
      ])
    ).toEqual([]);
    const cross = fixtures.TSLA.html.replaceAll(
      'dimension="srt:ProductOrServiceAxis"',
      'dimension="srt:GeographicalAxis"'
    );
    expect(
      enrichBusinessPeriods(cross, fixtures.TSLA.identity, fixtures.TSLA.filing, [
        fixtures.TSLA.consolidated
      ])
    ).toEqual([]);
  });

  it("does not combine product-axis rows with nondimensional custom revenue", () => {
    const f = synthetic();
    const mixed = f.html
      .replace(
        '<xbrli:context id="ca"><xbrli:entity>',
        '<xbrli:context id="ca"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">test:AMember</xbrldi:explicitMember></xbrli:segment>'
      )
      .replace('name="test:RevenueA"', 'name="us-gaap:Revenues"');
    expect(enrichBusinessPeriods(mixed, f.identity, f.filing, [f.period])).toEqual([]);
  });

  it("requires a reported subtotal to reconcile before omitting it", () => {
    const { html, identity, filing, consolidated } = fixtures.TSLA;
    const inconsistent = html.replaceAll("20,516", "20,526");
    expect(enrichBusinessPeriods(inconsistent, identity, filing, [consolidated])).toEqual([]);
    const notSubtotal = html.replaceAll("Total automotive revenues", "Automotive revenues");
    expect(enrichBusinessPeriods(notSubtotal, identity, filing, [consolidated])).toEqual([]);
  });

  it("requires period and currency alignment", () => {
    const f = synthetic();
    for (const period of [
      { ...f.period, startDate: "2026-01-01" },
      { ...f.period, displayCurrency: "TWD" },
      { ...f.period, accession: "0000063908-25-000073" }
    ])
      expect(enrichBusinessPeriods(f.html, f.identity, f.filing, [period])).toEqual([]);
  });

  it("rejects stale or corrupted branch provenance on reads", () => {
    const original = fixtures.MCD.period;
    const edit = (change: (period: PeriodV2) => void) => {
      const period = structuredClone(original);
      change(period);
      expect(businessPeriod(period)).toBeUndefined();
    };
    edit((p) => {
      p.segments![0].revenueSource!.value += 1;
    });
    edit((p) => {
      p.segments![0].revenueSource!.tableLabel = "Invented label";
    });
    edit((p) => {
      p.segments![0].revenueSource!.startDate = "2026-01-01";
    });
    edit((p) => {
      p.segments![0].revenueSource!.dimensions = { "srt:GeographicalAxis": "test:WorldMember" };
    });
    edit((p) => {
      p.businessBreakdownSource!.revenueDecimals = 3;
      for (const s of p.segments!) s.revenueSource!.decimals = 3;
    });
    edit((p) => {
      p.revenueAdjustments![0].label = "Unexplained difference";
    });
    const mismatchedCost = structuredClone(fixtures.TSLA.period);
    mismatchedCost.segments![0].grossProfitSource!.dimensions = {
      "srt:ProductOrServiceAxis": "test:DifferentBusinessMember"
    };
    expect(businessPeriod(mismatchedCost)).toBeUndefined();
  });
});
