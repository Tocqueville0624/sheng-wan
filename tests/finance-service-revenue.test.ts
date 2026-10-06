import { describe, expect, it } from "vitest";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { enrichServiceRevenuePeriods } from "../scripts/finance/service-revenue-v2";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import {
  serviceRevenueAxis,
  serviceRevenueRowsProblem
} from "../src/features/finance/service-revenue-rows";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

// Exact amounts independently transcribed from original SEC service tables,
// in USD thousands. Fixtures preserve original declarations and physical cells.
const cases = [
  [
    "AKAMServicesFY2017",
    "web-media",
    ["Web Division", "Media and Carrier Division"],
    [1307641, 1181394]
  ],
  [
    "AKAMServicesFY2019",
    "technology-groups",
    ["Security Technology Group", "Edge Technology Group"],
    [848733, 2044884]
  ],
  [
    "AKAMServicesFY2020",
    "security-delivery-compute",
    ["Security", "Delivery", "Compute"],
    [1061622, 1929810, 206717]
  ],
  [
    "AKAMServicesFY2022",
    "security-delivery-compute",
    ["Security", "Delivery", "Compute"],
    [1541941, 1669257, 405456]
  ],
  [
    "AKAMServicesFY2025",
    "security-delivery-cloud",
    ["Security", "Delivery", "Cloud computing"],
    [2243404, 1256721, 708050]
  ],
  [
    "AKAMServices2026Q2",
    "security-applications-infrastructure",
    ["Security", "Delivery and other cloud applications", "Cloud infrastructure services"],
    [604436, 395927, 99319]
  ],
  [
    "AKAMServices2024Q1",
    "security-delivery-cloud",
    ["Security", "Delivery", "Cloud computing"],
    [490681, 351758, 144531]
  ],
  [
    "AKAMServices2021Q3",
    "technology-groups-legacy-members",
    ["Security Technology Group", "Edge Technology Group"],
    [334649, 525684]
  ]
] as const;

describe("Akamai complete original service revenue rows", () => {
  it.each(cases)(
    "preserves %s classification, original amounts and both revenue anchors",
    (key, profile, labels, amounts) => {
      const f = reviewedFixture(key),
        p = f.period;
      expect(p.segments?.map((s) => s.label)).toEqual(labels);
      expect(p.segments?.map((s) => s.revenue)).toEqual(amounts.map((n) => n * 1000));
      expect(p.segments?.reduce((n, s) => n + s.revenue, 0)).toBe(p.metrics.revenue);
      expect(p.revenueAdjustments).toBeUndefined();
      expect(p.businessBreakdownSource).toMatchObject({
        method: "reviewed-service-revenue-rows",
        ruleId: `akam-original-service-rows-${profile}-v1`,
        sourceUrl: f.filing.sourceUrl
      });
      const proof = p.businessBreakdownSource!.serviceRevenueRows!;
      expect(proof.tableIndex).toBe(1);
      expect(proof.primary.tableIndex).toBe(0);
      expect(proof.rows.length).toBeGreaterThan(labels.length + 1);
      for (const s of p.segments!) {
        expect(s.revenueSource?.tag).toBe(
          "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax"
        );
        expect(s.revenueSource?.dimensions).toHaveProperty(serviceRevenueAxis);
        expect(s.revenueSource?.calculation).toBeUndefined();
        expect(s.grossProfit).toBeUndefined();
      }
      expect(serviceRevenueRowsProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
      // Re-reading the business table never changes independent financial amounts.
      const original = { ...f.basic, metrics: p.metrics, metricSources: p.metricSources };
      const recovered = enrichServiceRevenuePeriods(
        f.html,
        f.identity,
        f.filing,
        [original],
        parseInlineXbrl(f.html)
      )[0]!;
      expect(recovered.metrics).toEqual(original.metrics);
      expect(recovered.metricSources).toEqual(original.metricSources);
      expect(recovered.segments).toEqual(p.segments);
      if (p.coverage.sankey) expect(flowPeriod(recovered)).toBeDefined();
    }
  );

  it.each(["AKAMServicesFY2025", "AKAMServices2026Q2"] as const)(
    "supports %s first import with no Company Facts",
    (key) => {
      const f = reviewedFixture(key);
      const p = readGenericFiling(f.html, f.identity, f.filing, undefined).find(
        (p) => p.id === f.period.id
      )!;
      expect(p.coverage).toEqual({ basics: true, segments: true, sankey: true });
      expect(p.segments).toEqual(f.period.segments);
      expect(p.businessBreakdownSource).toEqual(f.period.businessBreakdownSource);
      for (const [metric, value] of Object.entries(p.metrics))
        expect(value).toBe(f.period.metrics[metric as keyof typeof p.metrics]);
      expect(p.metrics.grossProfit).toBeUndefined();
      expect(p.metrics.costOfRevenue).toBeUndefined();
    }
  );

  it("preserves the 2021 changed captions with unchanged current member names", () => {
    const p = reviewedFixture("AKAMServices2021Q3").period;
    expect(p.segments![0].revenueSource!.dimensions).toEqual({
      [serviceRevenueAxis]: "akam:WebDivisionMember"
    });
    expect(p.segments![1].revenueSource!.dimensions).toEqual({
      [serviceRevenueAxis]: "akam:MediaandCarrierDivisionMember"
    });
    const members = p.businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) =>
      r.cells.flatMap((c) => (c.fact ? Object.values(c.fact.dimensions) : []))
    );
    expect(new Set(members)).toEqual(
      new Set(["akam:WebDivisionMember", "akam:MediaandCarrierDivisionMember"])
    );
  });

  it("keeps original aggregate primary scope distinct from nondimensional business closing total", () => {
    const p = reviewedFixture("AKAMServicesFY2022").period,
      proof = p.businessBreakdownSource!.serviceRevenueRows!;
    const current = (row: typeof proof.primary.revenue) =>
      row.cells.find((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)!
        .fact!;
    expect(current(proof.primary.revenue).dimensions).toEqual({
      "us-gaap:StatementBusinessSegmentsAxis": "akam:ReportableSegmentMember"
    });
    expect(current(proof.rows.at(-1)!).dimensions).toEqual({});
    expect(current(proof.primary.revenue).value).toBe(current(proof.rows.at(-1)!).value);
    expect(p.coverage.segments).toBe(true);
    // The excerpt omits unrelated standard income anchors: do not fabricate them.
    expect(p.coverage.sankey).toBe(false);
  });

  it("retains both original nested declaration scopes rather than rewriting a context", () => {
    const p = reviewedFixture("AKAMServices2024Q1").period;
    const cells = p.businessBreakdownSource!.serviceRevenueRows!.primary.revenue.cells.filter(
      (c) => c.fact?.corroboratingContexts?.length
    );
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.fact!.declarations).toHaveLength(2);
      expect(new Set(c.fact!.declarations.map((d) => d.contextId)).size).toBe(2);
      expect(c.fact!.corroboratingContexts![0].dimensions).toEqual({});
      const bad = structuredClone(p);
      bad.businessBreakdownSource!.serviceRevenueRows!.primary.revenue.cells.find(
        (x) => x.columnIndex === c.columnIndex
      )!.fact!.corroboratingContexts![0].dimensions = { "srt:GeographicalAxis": "akam:USMember" };
      expect(businessPeriod(bad)).toBeUndefined();
    }
  });

  const changes: [string, (p: PeriodV2) => void][] = [
    [
      "stored branch amount",
      (p) => {
        p.segments![0].revenue += 1000;
      }
    ],
    [
      "issuer",
      (p) => {
        p.sourceUrl = p.sourceUrl.replace("1086222/", "1086223/");
      }
    ],
    [
      "currency",
      (p) => {
        p.reportingCurrency = "EUR";
      }
    ],
    [
      "wrong proof method",
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "unreviewed rule",
      (p) => {
        p.businessBreakdownSource!.serviceRevenueRows!.ruleId += "-unknown";
      }
    ],
    [
      "missing closing row",
      (p) => {
        p.businessBreakdownSource!.serviceRevenueRows!.rows.pop();
      }
    ],
    [
      "changed source year",
      (p) => {
        const proof = p.businessBreakdownSource!.serviceRevenueRows!;
        proof.rows.flatMap((r) => r.cells).find((c) => c.label === "2026")!.label = "2027";
      }
    ],
    [
      "changed source duration caption",
      (p) => {
        const c = p
          .businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) => r.cells)
          .find((c) => c.label.startsWith("For the Three"))!;
        c.label = c.label.replace("Three", "Six");
      }
    ],
    [
      "renamed primary heading",
      (p) => {
        p.businessBreakdownSource!.serviceRevenueRows!.primary.title =
          "CONSOLIDATED STATEMENTS OF CASH FLOWS";
      }
    ],
    [
      "overlapping original columns",
      (p) => {
        p.businessBreakdownSource!.serviceRevenueRows!.rows.at(-1)!.cells[1].columnIndex += 1;
      }
    ],
    [
      "misdated original fact",
      (p) => {
        const c = p
          .businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact?.startDate === p.startDate)!;
        c.fact!.endDate = "2026-09-30";
      }
    ],
    [
      "wrong member",
      (p) => {
        p
          .businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact && Object.keys(c.fact.dimensions).length)!.fact!.dimensions = {
          [serviceRevenueAxis]: "akam:UnknownMember"
        };
      }
    ],
    [
      "changed declaration precision",
      (p) => {
        p
          .businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact)!.fact!.decimals = -6;
      }
    ],
    [
      "incompatible declaration unit",
      (p) => {
        p
          .businessBreakdownSource!.serviceRevenueRows!.rows.flatMap((r) => r.cells)
          .find((c) => c.fact)!.fact!.declarations[0].unitRef = "EUR";
      }
    ],
    [
      "extra mixed proof",
      (p) => {
        p.businessBreakdownSource!.axis = serviceRevenueAxis;
      }
    ]
  ];
  it.each(changes)(
    "withholds %s instead of making a proportional but false partition",
    (_name, change) => {
      const p = structuredClone(reviewedFixture("AKAMServices2026Q2").period);
      change(p);
      expect(serviceRevenueRowsProblem(p)).toBeDefined();
      expect(businessPeriod(p)).toBeUndefined();
    }
  );

  it.each(["missing total", "unknown member", "untagged amount", "changed heading", "wrong units"])(
    "rejects original-source mutation: %s",
    (change) => {
      const f = reviewedFixture("AKAMServices2026Q2");
      let html = f.html;
      if (change === "changed heading")
        html = html.replaceAll(
          "CONSOLIDATED STATEMENTS OF INCOME",
          "CONSOLIDATED STATEMENTS OF CASH FLOWS"
        );
      else if (change === "wrong units") html = html.replaceAll("iso4217:USD", "iso4217:EUR");
      else if (change === "unknown member")
        html = html.replaceAll("akam:SecurityMember", "akam:UnknownMember");
      else
        html = html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table, offset) => {
          if (offset === html.indexOf("<table")) return table;
          if (change === "missing total")
            return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) =>
              row.includes("Total revenue") ? "" : row
            );
          // Test-only removal of a source declaration; visible monetary text survives.
          return table.replace(/<ix:nonFraction\b[^>]*>([\s\S]*?)<\/ix:nonFraction>/i, "$1");
        });
      expect(html).not.toBe(f.html);
      if (change === "wrong units") {
        expect(() => parseInlineXbrl(html)).toThrow("No monetary inline-XBRL facts were found");
      } else {
        expect(
          enrichServiceRevenuePeriods(html, f.identity, f.filing, [f.basic], parseInlineXbrl(html))
        ).toEqual([]);
      }
    }
  );
});
