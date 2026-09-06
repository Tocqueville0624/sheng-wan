import { describe, expect, it } from "vitest";
import snapshot from "../src/data/generated/finance.json";
import type { FinanceManifest, FinancialPeriod } from "../src/features/finance/types";
import {
  buildRevenueHistory,
  buildStatementFlow,
  businessGrossMargin,
  layoutStatementFlow,
  segmentProblem,
  accountingTolerance,
  revenueAdjustmentLabel,
  type StatementFlow
} from "../src/features/finance/chart-model";

const apple = (snapshot as FinanceManifest).companies.find((company) => company.ticker === "AAPL")!;
const base = apple.annual.at(-1)!;
const fixture = (changes: Partial<FinancialPeriod["metrics"]> = {}): FinancialPeriod => ({
  ...base,
  segments: [
    { id: "product", label: "Products", revenue: 70 },
    { id: "service", label: "Services", revenue: 30 }
  ],
  metrics: {
    revenue: 100,
    costOfRevenue: 55,
    grossProfit: 45,
    operatingExpenses: 20,
    operatingIncome: 25,
    pretaxIncome: 28,
    incomeTax: 6,
    netIncome: 22,
    researchAndDevelopment: 8,
    sellingGeneralAndAdministrative: 7,
    ...changes
  }
});

it("distinguishes unavailable, zero, tiny and negative business gross margins", () => {
  const business = {
    id: "services",
    label: "Services",
    revenue: 100,
    grossProfitSource: {
      sourceUrl: base.sourceUrl,
      filedAt: base.filedAt,
      startDate: base.startDate,
      endDate: base.endDate,
      reportingCurrency: "USD",
      method: "reported" as const,
      revenueTag: "us-gaap:Revenues",
      tag: "us-gaap:GrossProfit",
      dimensions: { "srt:ProductOrServiceAxis": "us-gaap:ServiceMember" },
      value: 0
    }
  };
  expect(businessGrossMargin(business)).toBe("—");
  expect(businessGrossMargin({ ...business, grossProfit: 0 })).toBe("0.0%");
  expect(businessGrossMargin({ ...business, grossProfit: 0.01 })).toBe("<0.1%");
  expect(businessGrossMargin({ ...business, grossProfit: -0.01 })).toBe(">−0.1%");
  expect(businessGrossMargin({ ...business, grossProfit: -125 })).toBe("−125.0%");
  expect(businessGrossMargin({ ...business, grossProfit: 75.4 })).toBe("75.4%");
  expect(businessGrossMargin({ ...business, revenue: 0, grossProfit: -5 })).toBe("—");
  expect(businessGrossMargin({ ...business, grossProfit: NaN })).toBe("—");
  expect(businessGrossMargin({ ...business, grossProfit: 50, grossProfitSource: undefined })).toBe(
    "—"
  );
  const period = fixture();
  period.segments![1] = { ...business, revenue: 29 };
  period.revenueAdjustments = [{ id: "hedging", label: "Hedging gain", revenue: 1 }];
  const result = buildStatementFlow(period);
  if (!result.ok) throw new Error(result.reason);
  expect(result.graph.nodes.find((node) => node.id === "segment-services")?.business).toBeDefined();
  expect(
    result.graph.nodes.find((node) => node.id === "adjustment-hedging")?.business
  ).toBeUndefined();
});

function expectConserved(graph: StatementFlow, revenue: number) {
  const tolerance = accountingTolerance(revenue);
  for (const node of graph.nodes) {
    expect(Number.isFinite(node.amount)).toBe(true);
    expect(node.amount).toBeGreaterThanOrEqual(0);
    for (const direction of ["source", "target"] as const) {
      const links = graph.links.filter((link) => link[direction] === node.id);
      if (links.length)
        expect(
          Math.abs(links.reduce((sum, link) => sum + link.value, 0) - node.amount)
        ).toBeLessThanOrEqual(tolerance);
    }
  }
  for (const link of graph.links) {
    expect(link.value).toBeGreaterThan(0);
    expect(graph.nodes.some((node) => node.id === link.source)).toBe(true);
    expect(graph.nodes.some((node) => node.id === link.target)).toBe(true);
  }
}

function expectNoUnrelatedNodeInterception(layout: ReturnType<typeof layoutStatementFlow>) {
  const cubic = (a: number, b: number, c: number, d: number, t: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  for (const link of layout.links) {
    const coordinates = link.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
    for (const node of layout.nodes) {
      if (node.id === link.source || node.id === link.target || node.height === 0) continue;
      for (const x of [node.x, node.x + layout.nodeWidth / 2, node.x + layout.nodeWidth]) {
        if (x <= coordinates[0] || x >= coordinates[6]) continue;
        let low = 0;
        let high = 1;
        for (let step = 0; step < 40; step++) {
          const t = (low + high) / 2;
          if (cubic(coordinates[0], coordinates[2], coordinates[4], coordinates[6], t) < x) low = t;
          else high = t;
        }
        const y = cubic(
          coordinates[1],
          coordinates[3],
          coordinates[5],
          coordinates[7],
          (low + high) / 2
        );
        const overlap = Math.min(y + link.width, node.y + node.height) - Math.max(y, node.y);
        expect(
          overlap,
          `${link.source}→${link.target} intercepts unrelated ${node.id}`
        ).toBeLessThanOrEqual(0.000001);
      }
    }
  }
}

function expectOrderedExactPorts(layout: ReturnType<typeof layoutStatementFlow>) {
  const coordinates = new Map(
    layout.links.map((link) => [
      link,
      link.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number)
    ])
  );
  for (const link of layout.links) {
    const values = coordinates.get(link)!;
    // The filled path, not only its metadata, must retain the exact width at
    // both endpoints; tiny disclosed items must never become minimum bars.
    expect(values[9] - values[7]).toBeCloseTo(link.width, 10);
    expect(values[15] - values[1]).toBeCloseTo(link.width, 10);
  }
  for (const node of layout.nodes) {
    for (const [ownEnd, otherEnd, coordinate] of [
      ["source", "target", 1],
      ["target", "source", 7]
    ] as const) {
      const links = layout.links
        .filter((link) => link[ownEnd] === node.id)
        .sort((a, b) => coordinates.get(a)![coordinate] - coordinates.get(b)![coordinate]);
      let edge = node.y;
      let previousAdjacentCenter = -Infinity;
      for (const link of links) {
        const adjacent = layout.nodes.find((entry) => entry.id === link[otherEnd])!;
        const center = adjacent.y + adjacent.height / 2;
        expect(center).toBeGreaterThanOrEqual(previousAdjacentCenter);
        expect(coordinates.get(link)![coordinate]).toBeCloseTo(edge, 10);
        edge += link.width;
        previousAdjacentCenter = center;
      }
      if (links.length) expect(edge).toBeCloseTo(node.y + node.height, 8);
    }
  }
}

describe("business-revenue chart", () => {
  it("does not substitute total revenue when category data is missing", () => {
    const unavailable = { ...fixture(), segments: undefined };
    const history = buildRevenueHistory([unavailable, fixture()]);
    expect(history.periods.map((period) => period.available)).toEqual([false, true]);
    expect(history.series.map((series) => series.id)).toEqual(["product", "service"]);
    expect(history.series.some((series) => series.id === "revenue")).toBe(false);
  });

  it("rejects negative, duplicated and unreconciled category splits", () => {
    expect(
      segmentProblem({ ...fixture(), segments: [{ id: "a", label: "A", revenue: -1 }] })
    ).toBeDefined();
    expect(
      segmentProblem({
        ...fixture(),
        segments: [
          { id: "a", label: "A", revenue: 60 },
          { id: "a", label: "A", revenue: 40 }
        ]
      })
    ).toBeDefined();
    expect(
      segmentProblem({ ...fixture(), segments: [{ id: "a", label: "A", revenue: 99.9 }] })
    ).toContain("reconcile");
  });

  it("uses reconciled, primary-source Apple categories for every available period", () => {
    expect(apple.dataStatus).toBe("verified");
    for (const period of [...apple.annual, ...apple.quarterly]) {
      expect(segmentProblem(period)).toBeUndefined();
      expect(period.segmentSourceUrl).toMatch(/^https:/);
    }
  });
});

describe("income statement Sankey", () => {
  it("draws a reported tax benefit as a green incoming flow and conserves signed equity items", () => {
    for (const equity of [-31, -0.5, 0, 0.5, 200]) {
      const period = fixture({ incomeTax: -6, equityMethodIncome: equity, netIncome: 34 + equity });
      const result = buildStatementFlow(period);
      if (!result.ok) throw new Error(result.reason);
      expectConserved(result.graph, period.metrics.revenue);
      expect(result.graph.nodes.find((node) => node.id === "tax-benefit")).toMatchObject({
        amount: 6,
        label: "Tax benefit",
        tone: "profit",
        group: "tax-benefit"
      });
      expect(result.graph.nodes.find((node) => node.id === "tax")).toBeUndefined();
      const benefitToNet = result.graph.links.find(
        (link) => link.source === "tax-benefit" && link.target === "net"
      );
      expect(benefitToNet).toMatchObject({ value: equity === -31 ? 3 : 6, tone: "profit" });
      const layout = layoutStatementFlow(result.graph);
      for (const link of layout.links)
        expect(link.width / link.value).toBeCloseTo(layout.scale, 12);
      for (const node of layout.nodes.filter((entry) => entry.amount > 0))
        expect(node.height / node.amount).toBeCloseTo(layout.scale, 12);
      expectNoUnrelatedNodeInterception(layout);
    }
  });

  it("gives positive and negative reported hedging adjustments explicit labels", () => {
    for (const value of [-0.5, 0.5]) {
      const period = fixture({ revenue: 100 + value, costOfRevenue: 55 + value });
      period.revenueAdjustments = [
        { id: "hedging", label: "Hedging gains (losses)", revenue: value }
      ];
      const result = buildStatementFlow(period);
      if (!result.ok) throw new Error(result.reason);
      expectConserved(result.graph, period.metrics.revenue);
      expect(result.graph.nodes.find((node) => node.id === "adjustment-hedging")).toMatchObject({
        label: value < 0 ? "Hedging loss" : "Hedging gain",
        tone: value < 0 ? "expense" : "profit",
        amount: 0.5
      });
      expect(revenueAdjustmentLabel(period.revenueAdjustments[0])).toBe(
        value < 0 ? "Hedging loss" : "Hedging gain"
      );
    }
  });
  it("shows reported after-tax equity-method income or loss as its own reconciled branch", () => {
    for (const equity of [-0.5, 0.5]) {
      const period = fixture({ equityMethodIncome: equity, netIncome: 22 + equity });
      const result = buildStatementFlow(period);
      if (!result.ok) throw new Error(result.reason);
      for (const node of result.graph.nodes) {
        const incoming = result.graph.links.filter((link) => link.target === node.id);
        const outgoing = result.graph.links.filter((link) => link.source === node.id);
        if (incoming.length)
          expect(incoming.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(node.amount, 10);
        if (outgoing.length)
          expect(outgoing.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(node.amount, 10);
      }
      expect(result.graph.nodes.find((node) => node.id === "equity")?.amount).toBe(0.5);
    }
  });

  it("accounts for separately disclosed revenue losses without inventing positive business splits", () => {
    const period = fixture({ revenue: 99.5, costOfRevenue: 54.5 });
    period.revenueAdjustments = [{ id: "hedging", label: "Hedging loss", revenue: -0.5 }];
    expect(segmentProblem(period)).toBeUndefined();
    const result = buildStatementFlow(period);
    if (!result.ok) throw new Error(result.reason);
    for (const node of result.graph.nodes) {
      const incoming = result.graph.links.filter((link) => link.target === node.id);
      const outgoing = result.graph.links.filter((link) => link.source === node.id);
      if (incoming.length)
        expect(incoming.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(node.amount, 10);
      if (outgoing.length)
        expect(outgoing.reduce((sum, link) => sum + link.value, 0)).toBeCloseTo(node.amount, 10);
    }
    expect(result.graph.nodes.find((node) => node.id === "revenue-base")?.amount).toBe(100);
    expect(result.graph.nodes.find((node) => node.id === "revenue")?.amount).toBe(99.5);
    expect(result.graph.links.find((link) => link.target === "adjustment-hedging")?.value).toBe(
      0.5
    );
  });

  it("uses staggered accounting stages and a populated source column, not a flat rectangular band", () => {
    const result = buildStatementFlow(fixture());
    if (!result.ok) throw new Error(result.reason);
    const layout = layoutStatementFlow(result.graph);
    const stages = layout.nodes.filter((node) => node.group === "main");
    expect(new Set(stages.map((node) => node.y)).size).toBe(5);
    expect(layout.nodes.find((node) => node.group === "segment")!.x).toBeLessThan(
      Math.min(...stages.map((node) => node.x)) - 80
    );
    expect(layout.links.every((link) => link.path.includes(" C "))).toBe(true);
  });

  it("spreads Microsoft's three businesses across the downstream drawing extent", () => {
    const microsoft = (snapshot as FinanceManifest).companies.find(
      (company) => company.ticker === "MSFT"
    )!;
    const period = microsoft.quarterly.find((entry) => entry.id === "2026-Q3")!;
    const result = buildStatementFlow(period);
    if (!result.ok) throw new Error(result.reason);
    const layout = layoutStatementFlow(result.graph);
    const sources = layout.nodes.filter((node) => node.group === "segment");
    expect(sources).toHaveLength(3);
    const top = Math.min(...sources.map((node) => node.y));
    const bottom = Math.max(...sources.map((node) => node.y + node.height));
    const downstream = layout.nodes.filter((node) => node.group !== "segment");
    const downstreamBottom = Math.max(...downstream.map((node) => node.y + node.height));
    // Source placement must respond to the costs/details extent, not remain a
    // compact stack at the top of a much taller accounting diagram.
    expect(bottom - top).toBeGreaterThan((layout.height - 112 - 110) * 0.7);
    expect(bottom).toBeGreaterThanOrEqual(downstreamBottom - 80);
    const revenue = layout.nodes.find((node) => node.id === "revenue")!;
    expect(sources[0].y + sources[0].height / 2).toBeLessThan(revenue.y);
    expect(sources.at(-1)!.y).toBeGreaterThan(revenue.y + revenue.height);
  });

  it("positions the main route from amount-weighted stage centers", () => {
    const layouts = [
      fixture(),
      fixture({
        costOfRevenue: 20,
        grossProfit: 80,
        operatingIncome: 60,
        pretaxIncome: 63,
        incomeTax: 10,
        netIncome: 53
      })
    ].map((period) => {
      const result = buildStatementFlow(period);
      if (!result.ok) throw new Error(result.reason);
      return layoutStatementFlow(result.graph);
    });
    for (const layout of layouts) {
      const center = (id: string) => {
        const node = layout.nodes.find((entry) => entry.id === id)!;
        return node.y + node.height / 2;
      };
      expect(center("revenue") - center("gross")).toBeCloseTo(20, 10);
      expect(center("gross") - center("operating")).toBeCloseTo(70, 10);
    }
    const revenueY = (layout: (typeof layouts)[number]) =>
      layout.nodes.find((node) => node.id === "revenue")!.y;
    // With the same total revenue/scale, a wider operating margin moves the
    // upstream center by half the additional operating-node height.
    expect(revenueY(layouts[1]) - revenueY(layouts[0])).toBeCloseTo(
      ((60 - 25) * layouts[0].scale) / 2,
      10
    );
  });

  it("puts upper gains in upper incoming ports without crossing the operating route", () => {
    const result = buildStatementFlow(
      fixture({ pretaxIncome: 125, incomeTax: -6, equityMethodIncome: 0.5, netIncome: 131.5 })
    );
    if (!result.ok) throw new Error(result.reason);
    const layout = layoutStatementFlow(result.graph);
    expectConserved(result.graph, 100);
    expectOrderedExactPorts(layout);
    expectNoUnrelatedNodeInterception(layout);
    for (const [sourceId, mainId] of [
      ["nonoperating", "operating"],
      ["tax-benefit", "pretax"],
      ["equity", "pretax"]
    ]) {
      const source = layout.nodes.find((node) => node.id === sourceId)!;
      const main = layout.nodes.find((node) => node.id === mainId)!;
      expect(source.y + source.height + 100).toBeLessThan(main.y);
    }
  });

  it("conserves dollars through every internal node, including non-operating gains and tax", () => {
    const result = buildStatementFlow(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const node of result.graph.nodes) {
      const inputs = result.graph.links.filter((link) => link.target === node.id);
      const outputs = result.graph.links.filter((link) => link.source === node.id);
      if (inputs.length)
        expect(inputs.reduce((total, link) => total + link.value, 0)).toBeCloseTo(node.amount, 10);
      if (outputs.length)
        expect(outputs.reduce((total, link) => total + link.value, 0)).toBeCloseTo(node.amount, 10);
    }
    expect(result.graph.nodes.find((node) => node.id === "nonoperating")?.amount).toBe(3);
    expect(result.graph.nodes.find((node) => node.id === "other-opex")?.amount).toBe(5);
    expect(result.graph.links.find((link) => link.target === "tax")?.source).toBe("pretax");
  });

  it("represents net non-operating losses explicitly instead of folding them into tax", () => {
    const result = buildStatementFlow(fixture({ pretaxIncome: 22, incomeTax: 4, netIncome: 18 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.links.find((link) => link.target === "nonoperating")).toMatchObject({
      source: "operating",
      value: 3,
      tone: "expense"
    });
    expect(result.graph.links.find((link) => link.target === "pretax")?.value).toBe(22);
    expect(result.graph.links.find((link) => link.target === "tax")?.value).toBe(4);
  });

  it("applies one unmodified dollars-to-pixels ratio to every ribbon and node", () => {
    const result = buildStatementFlow(fixture({ researchAndDevelopment: 0.001 }));
    if (!result.ok) throw new Error(result.reason);
    const layout = layoutStatementFlow(result.graph);
    for (const link of layout.links) {
      expect(link.width / link.value).toBeCloseTo(layout.scale, 12);
      expect(link.path).not.toMatch(/NaN|Infinity/);
    }
    for (const node of layout.nodes.filter((node) => node.amount > 0)) {
      expect(node.height / node.amount).toBeCloseTo(layout.scale, 12);
    }
    const tiny = layout.links.find((link) => link.target === "rd")!;
    expect(tiny.width).toBeLessThan(1);
    const largest = layout.links.find((link) => link.target === "revenue")!;
    expect(largest.width / tiny.width).toBeCloseTo(largest.value / tiny.value, 8);
  });

  it("withholds negative profits and discrepancies rather than clamping or inventing flows", () => {
    expect(buildStatementFlow(fixture({ netIncome: -3, incomeTax: 31 })).ok).toBe(false);
    expect(
      buildStatementFlow(fixture({ pretaxIncome: -1, incomeTax: -30, netIncome: 29 })).ok
    ).toBe(false);
    expect(buildStatementFlow(fixture({ incomeTax: -1, netIncome: 29 })).ok).toBe(true);
    expect(buildStatementFlow(fixture({ netIncome: 21.9 })).ok).toBe(false);
    expect(buildStatementFlow(fixture({ researchAndDevelopment: 30 })).ok).toBe(false);
    expect(buildStatementFlow(fixture({ revenue: Number.NaN })).ok).toBe(false);
  });

  it("renders all 63 real statements with conserved geometry and no unrelated node interception", () => {
    const companies = (snapshot as FinanceManifest).companies;
    expect(
      companies.reduce(
        (count, company) => count + company.annual.length + company.quarterly.length,
        0
      )
    ).toBe(63);
    for (const company of companies) {
      for (const period of [...company.annual, ...company.quarterly]) {
        const result = buildStatementFlow(period);
        expect(result.ok, `${company.ticker} ${period.label}`).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        expectConserved(result.graph, period.metrics.revenue);
        const layout = layoutStatementFlow(result.graph);
        expectNoUnrelatedNodeInterception(layout);
        expectOrderedExactPorts(layout);
        for (const link of layout.links) {
          expect(link.path).not.toMatch(/NaN|Infinity/);
          expect(link.width / link.value).toBeCloseTo(layout.scale, 12);
        }
        for (const node of layout.nodes)
          expect(node.y + node.height).toBeLessThan(layout.height - 90);
      }
    }
  });

  it("keeps high-tax and large non-operating branches clear of expense detail", () => {
    const cases = [
      fixture({
        costOfRevenue: 5,
        grossProfit: 95,
        operatingExpenses: 5,
        operatingIncome: 90,
        pretaxIncome: 90,
        incomeTax: 80,
        netIncome: 10,
        researchAndDevelopment: 2,
        sellingGeneralAndAdministrative: 3
      }),
      fixture({ pretaxIncome: 400, incomeTax: 100, netIncome: 300 })
    ];
    for (const period of cases) {
      const result = buildStatementFlow(period);
      if (!result.ok) throw new Error(result.reason);
      const layout = layoutStatementFlow(result.graph);
      const tax = layout.nodes.find((node) => node.id === "tax")!;
      const detail = layout.nodes.filter((node) => node.group === "detail");
      expect(Math.min(...detail.map((node) => node.y))).toBeGreaterThan(tax.y + tax.height + 80);
      const nonoperating = layout.nodes.find((node) => node.id === "nonoperating");
      if (nonoperating) {
        const opex = layout.nodes.find((node) => node.id === "opex")!;
        expect(opex.y).toBeGreaterThan(nonoperating.y + nonoperating.height + 80);
      }
      for (const node of layout.nodes)
        expect(node.y + node.height).toBeLessThan(layout.height - 90);
    }
  });
});
