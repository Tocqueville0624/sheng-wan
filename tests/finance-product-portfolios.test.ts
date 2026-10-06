import { describe, expect, it } from "vitest";
import { readGenericFiling } from "../scripts/finance/generic-import";
import { parseInlineXbrl } from "../scripts/finance/ixbrl";
import { visibleText } from "../scripts/finance/business-v2";
import { enrichProductPortfolioPeriods } from "../scripts/finance/product-portfolio-v2";
import { businessPeriod, flowPeriod, validateV2 } from "../scripts/finance/v2-model";
import { productPortfolioProblem } from "../src/features/finance/product-portfolios";
import type { PeriodV2 } from "../src/features/finance/v2-types";
import { reviewedFixture } from "./fixtures/finance/reviewed-fixtures";

// Original complete product sections, not generated revenue fixtures. Amounts below
// are independent sums of the original source-ordered product totals, in USD millions.
const cases = [
  [
    "ABBVProductFY2025",
    [
      "Immunology",
      "Neuroscience",
      "Oncology",
      "Aesthetics",
      "Eye Care",
      "Other Key Products",
      "All other"
    ],
    [30406, 10767, 6655, 4860, 2109, 3736, 2627]
  ],
  [
    "ABBVProduct2026Q2",
    ["Immunology", "Neuroscience", "Oncology", "Aesthetics", "Other Key Products", "All other"],
    [8786, 3228, 1650, 1282, 935, 1109]
  ],
  [
    "ABBVProductFY2020",
    [
      "Immunology",
      "Hematologic Oncology",
      "Aesthetics",
      "Neuroscience",
      "Eye Care",
      "Other Key Products",
      "All other"
    ],
    [22153, 6651, 2590, 3496, 2184, 3611, 5119]
  ],
  [
    "ABBVProductFY2021",
    [
      "Immunology",
      "Oncology",
      "Aesthetics",
      "Neuroscience",
      "Eye Care",
      "Other Key Products",
      "All other"
    ],
    [25284, 7228, 5233, 5927, 3567, 3939, 5019]
  ],
  [
    "ABBVProduct2022Q1",
    [
      "Immunology",
      "Hematologic Oncology",
      "Aesthetics",
      "Neuroscience",
      "Eye Care",
      "Other Key Products",
      "All other"
    ],
    [6141, 1646, 1374, 1488, 771, 907, 1211]
  ],
  [
    "ABBVProduct2024Q1",
    [
      "Immunology",
      "Neuroscience",
      "Oncology",
      "Aesthetics",
      "Eye Care",
      "Other Key Products",
      "All other"
    ],
    [5371, 1965, 1543, 1249, 538, 900, 744]
  ]
] as const;

function changeRow(html: string, label: string, update: (row: string) => string) {
  let found = false;
  const output = html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (!found && visibleText(row).startsWith(label)) {
      found = true;
      return update(row);
    }
    return row;
  });
  expect(found, `Original row ${label}`).toBe(true);
  return output;
}

describe("AbbVie original product portfolio partitions", () => {
  it.each(cases)(
    "preserves %s complete product hierarchy, source scopes and exact sums",
    (key, labels, values) => {
      const f = reviewedFixture(key),
        p = f.period;
      expect(p.segments?.map((s) => s.label)).toEqual(labels);
      expect(p.segments?.map((s) => s.revenue)).toEqual(values.map((v) => v * 1e6));
      expect(p.segments?.reduce((sum, s) => sum + s.revenue, 0)).toBe(p.metrics.revenue);
      expect(p.revenueAdjustments).toBeUndefined();
      expect(p.businessBreakdownSource).toMatchObject({
        method: "reported-product-portfolios",
        ruleId: "abbv-original-product-portfolios-v1",
        totalLabel: "Total net revenues",
        sourceUrl: f.filing.sourceUrl,
        accession: f.filing.accession
      });
      const proof = p.businessBreakdownSource!.productPortfolios!;
      expect(proof.tables).toHaveLength(2);
      expect(proof.continuations).toHaveLength(1);
      expect(proof.primary.tableIndex).toBe(0);
      expect(proof.tables.map((t) => t.tableIndex)).toEqual([1, 3]);
      for (const s of p.segments!) {
        expect(s.revenueSource).toMatchObject({
          tag: "sum of reported product revenues",
          dimensions: {},
          calculation: { method: "sum-of-reported-products" }
        });
        expect(s.revenueSource!.calculation!.products.length).toBeGreaterThan(0);
        for (const id of s.revenueSource!.calculation!.products)
          expect(
            proof.products.some(
              (product) => product.id === id && (product.portfolio ?? product.label) === s.label
            )
          ).toBe(true);
      }
      expect(productPortfolioProblem(p)).toBeUndefined();
      expect(businessPeriod(p)).toBeDefined();
      expect(flowPeriod(p)).toBeDefined();
      expect(() => validateV2(f.company)).not.toThrow();
      const original = { ...f.basic, ...{ metrics: p.metrics, metricSources: p.metricSources } };
      const recovered = enrichProductPortfolioPeriods(
        f.html,
        f.identity,
        f.filing,
        [original],
        parseInlineXbrl(f.html)
      )[0]!;
      expect(recovered.metrics).toEqual(original.metrics);
      expect(recovered.metricSources).toEqual(original.metricSources);
      expect(recovered.segments).toEqual(p.segments);
    }
  );

  it.each(["ABBVProductFY2025", "ABBVProduct2026Q2"] as const)(
    "supports first %s import with empty Company Facts",
    (key) => {
      const f = reviewedFixture(key);
      const imported = readGenericFiling(f.html, f.identity, f.filing, undefined).find(
        (p) => p.id === f.period.id
      )!;
      expect(imported).toBeDefined();
      expect(imported.segments).toEqual(f.period.segments);
      expect(imported.businessBreakdownSource).toEqual(f.period.businessBreakdownSource);
      // Company Facts may add independent cost/SG&A metrics. Empty-facts imports
      // retain the primary accounting chain without manufacturing those metrics.
      expect(imported.metrics).toMatchObject({
        revenue: f.period.metrics.revenue,
        totalOperatingCosts: f.period.metrics.totalOperatingCosts,
        operatingIncome: f.period.metrics.operatingIncome,
        pretaxIncome: f.period.metrics.pretaxIncome,
        incomeTax: f.period.metrics.incomeTax,
        netIncome: f.period.metrics.netIncome
      });
      for (const [metric, value] of Object.entries(imported.metrics))
        expect(value).toBe(f.period.metrics[metric as keyof typeof imported.metrics]);
      expect(imported.coverage).toEqual({ basics: true, segments: true, sankey: true });
    }
  );

  it("uses the original single-quarter caption and both original comparison years", () => {
    const f = reviewedFixture("ABBVProduct2022Q1");
    expect(
      f.period.businessBreakdownSource!.productPortfolios!.tables.every(
        (t) =>
          t.temporal.method === "original-single-Q1-table-caption" &&
          t.quarter1ComparisonYears!.map((y) => y.label).includes("2022")
      )
    ).toBe(true);
    const p = reviewedFixture("ABBVProduct2024Q1").period;
    const zeros = p
      .businessBreakdownSource!.productPortfolios!.products.flatMap((product) =>
        product.rows.flatMap((row) => row.cells.flatMap((c) => c.facts))
      )
      .filter((f) => f.value === 0);
    expect(zeros.length).toBeGreaterThan(0);
    expect(zeros.every((f) => f.declarations.some((d) => d.format === "ixt:fixed-zero"))).toBe(
      true
    );
  });

  it("withholds the actual misdated FY2017 zero instead of treating a blank or a different quarter as zero", () => {
    const f = reviewedFixture("ABBVProductFY2017");
    const parsed = parseInlineXbrl(f.html);
    expect(
      parsed.facts.some(
        (f) =>
          f.value === 0 &&
          f.context.dimensions["srt:ProductOrServiceAxis"] === "abbv:ORILISSAMember" &&
          f.context.start === "2019-07-01" &&
          f.context.end === "2019-09-30"
      )
    ).toBe(true);
    expect(enrichProductPortfolioPeriods(f.html, f.identity, f.filing, [f.basic], parsed)).toEqual(
      []
    );
    expect(f.period.coverage.segments).toBe(false);
    expect(f.period.segments).toBeUndefined();
  });

  it("rejects incomplete original sections, changed units, scopes, current amounts, captions or pagination", () => {
    const f = reviewedFixture("ABBVProduct2026Q2");
    const read = (html: string) => {
      let parsed;
      try {
        parsed = parseInlineXbrl(html);
      } catch (error) {
        expect((error as Error).message).toBe(
          "No monetary inline-XBRL facts were found in the SEC filing."
        );
        return [];
      }
      return enrichProductPortfolioPeriods(html, f.identity, f.filing, [f.basic], parsed);
    };
    const tables = [...f.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
    expect(tables).toHaveLength(4);
    const variants = [
      f.html.replace(tables[0][0], ""),
      f.html.replace(tables[3][0], ""),
      f.html.replace(tables[2][0], ""),
      f.html.replace(tables[2][0], tables[2][0].replaceAll("2026", "2025")),
      changeRow(f.html, "Total net revenues", () => ""),
      changeRow(f.html, "Humira", () => ""),
      changeRow(f.html, "Humira", (row) => row + row),
      changeRow(f.html, "Humira", (row) =>
        row.replace(/>([0-9][0-9,]*)<\/ix:nonFraction>/, ">99,999</ix:nonFraction>")
      ),
      changeRow(f.html, "Humira", (row) => row.replaceAll("Humira", "Unreviewed new product")),
      f.html.replaceAll(">Immunology<", ">Unreviewed portfolio<"),
      f.html.replaceAll("abbv:ImmunologyMember", "abbv:NewPortfolioMember"),
      f.html.replaceAll("abbv:HUMIRAMember", "abbv:NewProductMember"),
      f.html.replaceAll("srt:StatementGeographicalAxis", "srt:UnreviewedAxis"),
      f.html.replaceAll("country:US", "country:CA"),
      f.html.replaceAll('unitRef="usd"', 'unitRef="unknown"'),
      f.html.replaceAll('scale="6"', 'scale="3"'),
      f.html.replaceAll('decimals="-6"', 'decimals="-3"'),
      f.html.replaceAll("Three months ended", "Six months ended"),
      changeRow(f.html, "Humira", (row) => row.replaceAll('contextRef="', 'contextRef="unknown-'))
    ];
    for (const [index, html] of variants.entries()) {
      expect(html, `Source mutation ${index} changes original`).not.toBe(f.html);
      expect(read(html), `Source mutation ${index} is withheld`).toEqual([]);
    }
    const foreign = { ...f.identity, cik: "0000320193" };
    expect(
      enrichProductPortfolioPeriods(f.html, foreign, f.filing, [f.basic], parseInlineXbrl(f.html))
    ).toEqual([]);
    expect(() =>
      enrichProductPortfolioPeriods(
        f.html,
        f.identity,
        { ...f.filing, sourceUrl: f.filing.sourceUrl.replace("1551152/", "320193/") },
        [f.basic],
        parseInlineXbrl(f.html)
      )
    ).toThrow(/identity mismatch/);
    expect(() =>
      enrichProductPortfolioPeriods(
        f.html,
        f.identity,
        { ...f.filing, sourceUrl: f.filing.sourceUrl.replace("https://", "https://user@") },
        [f.basic],
        parseInlineXbrl(f.html)
      )
    ).toThrow(/identity mismatch/);
  });

  it("revalidates original source proof and calculated inputs on stored reads", () => {
    const f = reviewedFixture("ABBVProductFY2025");
    const mutations: ((p: PeriodV2) => void)[] = [
      (p) => {
        delete p.businessBreakdownSource!.productPortfolios;
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.tables.pop();
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.continuations[0].label = "2025 Form 10-Q | 1";
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.tables[0].year.columnIndex++;
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.headings[0].label = "New portfolio";
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.products.pop();
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.products[0].rows.pop();
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.products[0].id = "abbv:OtherProductsMember";
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.products[0].rows[0].cells.find(
          (c) => c.facts.length
        )!.facts[0].value++;
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.primary.cell.facts[0].value++;
      },
      (p) => {
        p.segments![0].revenue++;
      },
      (p) => {
        p.segments![0].revenueSource!.calculation!.products.pop();
      },
      (p) => {
        p.segments![0].revenueSource!.tag = "us-gaap:Revenues";
      },
      (p) => {
        p.segments![0].revenueSource!.dimensions = {
          "abbv:KeyProductPortfolioAxis": "abbv:ImmunologyMember"
        };
      },
      (p) => {
        p.segments!.reverse();
      },
      (p) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      },
      (p) => {
        p.businessBreakdownSource!.productPortfolios!.startDate = "2024-01-01";
      }
    ];
    for (const mutate of mutations) {
      const p = structuredClone(f.period);
      mutate(p);
      expect(businessPeriod(p)).toBeUndefined();
      expect(flowPeriod(p)).toBeUndefined();
    }
    const reordered = structuredClone(f.period);
    reordered.segments = reordered.segments!.map((s) => ({
      revenueSource: s.revenueSource,
      revenue: s.revenue,
      label: s.label,
      id: s.id
    }));
    expect(productPortfolioProblem(reordered)).toBeUndefined();
    expect(businessPeriod(reordered)).toBeDefined();
  });
});
