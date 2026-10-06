import type { BusinessPeriod, FlowStatementPeriod, RevenueSegment } from "./types";
import { buildSignedStatementFlow, layoutSignedStatementFlow } from "./signed-flow";
import { shareholderBridgeProblem } from "./shareholder-bridge";
import { operatingItemsProblem } from "./operating-items";

export type RevenueSeries = { id: string; label: string };
export type RevenueHistory = {
  series: RevenueSeries[];
  periods: { period: BusinessPeriod; available: boolean; reason?: string }[];
};

// A single scale is used for every node and ribbon. Never inflate thin branches.
export type FlowTone = "revenue" | "profit" | "expense";
export type FlowNode = {
  id: string;
  label: string;
  amount: number;
  /** Original signed income subtotal; the geometric amount remains its magnitude. */
  signedAmount?: number;
  /** Chronological accounting stage used by a signed statement's layout. */
  stage?: number;
  business?: RevenueSegment;
  tone: FlowTone;
  group:
    | "segment"
    | "main"
    | "cost"
    | "opex"
    | "detail"
    | "nonoperating"
    | "tax"
    | "tax-benefit"
    | "equity"
    | "subsidiary"
    | "noncontrolling"
    | "shareholder"
    | "discontinued"
    | "operating-adjustment"
    | "operating-item"
    | "after-tax-adjustment"
    | "revenue-base"
    | "adjustment";
};
export type FlowLink = { source: string; target: string; value: number; tone: FlowTone };
export type StatementFlow = {
  nodes: FlowNode[];
  links: FlowLink[];
  signedAccounting?: true;
};
export type FlowResult = { ok: true; graph: StatementFlow } | { ok: false; reason: string };
export type PositionedNode = FlowNode & { x: number; y: number; height: number };
export type PositionedLink = FlowLink & { path: string; width: number; annotationPath: string };

export function accountingTolerance(revenue: number) {
  return Math.max(0.000001, Math.abs(revenue) * 1e-9);
}

export function segmentProblem(period: BusinessPeriod): string | undefined {
  if (!Number.isFinite(period.metrics.revenue) || period.metrics.revenue <= 0) {
    return "Positive reported revenue is required for this business-category chart.";
  }
  const segments = period.segments;
  if (!segments?.length) return "No reconciled business-category data in this snapshot.";
  if (
    segments.some((segment) => !Number.isFinite(segment.revenue) || segment.revenue < 0) ||
    new Set(segments.map((segment) => segment.id)).size !== segments.length
  ) {
    return "Business-category values are invalid or duplicated.";
  }
  const adjustments = period.revenueAdjustments ?? [];
  if (adjustments.some((item) => !Number.isFinite(item.revenue))) {
    return "Revenue adjustments contain invalid values.";
  }
  const total = [...segments, ...adjustments].reduce((sum, segment) => sum + segment.revenue, 0);
  if (Math.abs(total - period.metrics.revenue) > accountingTolerance(period.metrics.revenue)) {
    return "Business categories do not reconcile with reported revenue.";
  }
  return undefined;
}

export function buildRevenueHistory(periods: BusinessPeriod[]): RevenueHistory {
  const series = new Map<string, RevenueSeries>();
  const entries = periods.map((period) => {
    const reason = segmentProblem(period);
    if (!reason) {
      period.segments!.forEach(({ id, label }) => series.set(id, { id, label }));
    }
    return { period, available: !reason, reason };
  });
  return { series: [...series.values()], periods: entries };
}

export function revenueAdjustmentLabel(adjustment: RevenueSegment) {
  if (adjustment.id === "hedging" || /\bhedg/i.test(adjustment.label)) {
    return adjustment.revenue < 0
      ? "Hedging loss"
      : adjustment.revenue > 0
        ? "Hedging gain"
        : "Hedging adjustment";
  }
  if (adjustment.revenue === 0) return adjustment.label;
  return `${adjustment.label} · ${adjustment.revenue < 0 ? "decrease" : "increase"}`;
}

export function buildStatementFlow(period: FlowStatementPeriod): FlowResult {
  const m = period.metrics;
  const shareholderProblem = shareholderBridgeProblem(period);
  if (shareholderProblem) return { ok: false, reason: shareholderProblem };
  const operatingProblem = operatingItemsProblem(period);
  if (operatingProblem) return { ok: false, reason: operatingProblem };
  if (period.grossProfitAdjustments?.some((item) => item.amount !== 0))
    return {
      ok: false,
      reason:
        "This filing reports separate gross-profit adjustments. Use the statement table and source filing; this flow chart does not model those adjustments."
    };
  const {
    equityMethodIncome = 0,
    afterTaxSubsidiaryIncome = 0,
    noncontrollingInterestIncome = 0,
    discontinuedOperationsIncome = 0,
    incomeTax,
    ...positiveMetrics
  } = m;
  // Some statements report no operating-profit line; their items between revenue
  // (or gross profit) and pretax profit are one reported net amount.
  const hasOperating = m.operatingIncome !== undefined;
  if (
    [m.revenue, m.pretaxIncome, incomeTax, m.netIncome].some((value) => value === undefined) ||
    (!hasOperating && m.expensesAndOtherItems === undefined)
  ) {
    return { ok: false, reason: "This statement is missing a required reported profit line." };
  }
  if (Object.values(m).some((value) => value !== undefined && !Number.isFinite(value))) {
    return { ok: false, reason: "This statement contains non-finite financial values." };
  }
  const signedAccounting =
    [m.grossProfit, m.operatingIncome, m.pretaxIncome, m.netIncome].some(
      (value) => value !== undefined && value < 0
    ) ||
    m.pretaxIncome < incomeTax ||
    !!period.shareholderBridge ||
    !!period.operatingItems;
  if (
    m.revenue <= 0 ||
    Object.entries(positiveMetrics).some(
      ([key, value]) =>
        !["grossProfit", "operatingIncome", "pretaxIncome", "netIncome"].includes(key) &&
        value !== undefined &&
        value < 0
    )
  ) {
    return {
      ok: false,
      reason:
        "This statement includes a nonpositive revenue or an unsupported negative cost. Use the statement table and original filing."
    };
  }
  const tolerance = accountingTolerance(m.revenue);
  const hasGrossStage =
    m.costOfRevenue !== undefined &&
    m.grossProfit !== undefined &&
    (m.operatingExpenses !== undefined || !hasOperating);
  if (hasOperating && !hasGrossStage && m.totalOperatingCosts === undefined) {
    return {
      ok: false,
      reason:
        "A reconciled gross-profit breakdown or reported total operating costs is required. No missing cost or gross-profit figures are estimated."
    };
  }
  const operatingReconciliation = !hasOperating ? undefined : period.operatingReconciliation;
  const operatingAdjustment = operatingReconciliation?.amount ?? 0;
  const afterTaxAdjustment = period.afterTaxReconciliation?.amount ?? 0;
  const operatingIncome = m.operatingIncome ?? 0;
  const operatingGains =
    period.operatingItems?.items
      .filter((item) => item.effect === "gain")
      .reduce((sum, item) => sum + item.amount, 0) ?? 0;
  if (
    !Number.isFinite(operatingAdjustment) ||
    !Number.isFinite(afterTaxAdjustment) ||
    (operatingReconciliation && !operatingReconciliation.sourceUrl) ||
    (operatingReconciliation &&
      hasGrossStage !== (operatingReconciliation.basis === "gross-profit")) ||
    (!signedAccounting && operatingIncome - Math.max(0, operatingAdjustment) < 0)
  ) {
    return {
      ok: false,
      reason: "The source rounding adjustment cannot form a valid positive flow."
    };
  }
  const identities: [number, number, string][] = [
    ...(hasGrossStage
      ? ([
          [
            m.revenue,
            m.costOfRevenue! + m.grossProfit!,
            "Revenue, cost of revenue, and gross profit"
          ],
          hasOperating
            ? [
                m.grossProfit! + operatingAdjustment,
                m.operatingExpenses! + operatingIncome,
                "Gross profit and operating items"
              ]
            : [
                m.grossProfit!,
                m.expensesAndOtherItems! + m.pretaxIncome,
                "Gross profit, expenses and other items, and pretax profit"
              ]
        ] as [number, number, string][])
      : hasOperating
        ? ([
            [
              m.revenue + operatingAdjustment + operatingGains,
              m.totalOperatingCosts! + operatingIncome,
              "Revenue, reported operating gains, total operating costs, operating profit, and source rounding"
            ]
          ] as [number, number, string][])
        : ([
            [
              m.revenue,
              m.expensesAndOtherItems! + m.pretaxIncome,
              "Revenue, costs and other items, and pretax profit"
            ]
          ] as [number, number, string][])),
    [
      m.pretaxIncome +
        equityMethodIncome +
        afterTaxSubsidiaryIncome +
        discontinuedOperationsIncome +
        afterTaxAdjustment,
      m.incomeTax + noncontrollingInterestIncome + m.netIncome,
      "Pretax profit, income tax, after-tax equity and subsidiary income, discontinued operations, noncontrolling interests, and net profit"
    ]
  ];
  for (const [total, parts, label] of identities) {
    if (Math.abs(total - parts) > tolerance) {
      return { ok: false, reason: `${label} do not reconcile. No balancing figures are invented.` };
    }
  }
  // These details describe expenses below gross profit. They must not be
  // relabelled as a breakdown of total operating costs on the direct route.
  const operatingGross = hasGrossStage && hasOperating;
  const drawExpenseComponents =
    !period.operatingExpensesBasis && !period.roundedOperatingExpenseComponents;
  const rd = operatingGross && drawExpenseComponents ? m.researchAndDevelopment : undefined;
  const sga =
    operatingGross && drawExpenseComponents ? m.sellingGeneralAndAdministrative : undefined;
  const other = operatingGross ? m.operatingExpenses! - (rd ?? 0) - (sga ?? 0) : 0;
  const disclosedExpenses = operatingGross ? period.operatingExpenseDetails : undefined;
  if (
    disclosedExpenses &&
    (!disclosedExpenses.length ||
      disclosedExpenses.some((item) => !Number.isFinite(item.amount) || item.amount < 0) ||
      Math.abs(
        disclosedExpenses.reduce((sum, item) => sum + item.amount, 0) - m.operatingExpenses!
      ) > tolerance)
  )
    return { ok: false, reason: "Disclosed operating expense components do not reconcile." };
  // Listed cost lines must be the reported partition of their parent cost node:
  // total operating costs, or expenses and other items without an operating line.
  const costParent = hasOperating ? (hasGrossStage ? undefined : "operating-costs") : "other-items";
  const costParentAmount = hasOperating ? m.totalOperatingCosts : m.expensesAndOtherItems;
  const costDetails = costParent ? period.operatingCostDetails : undefined;
  if (
    costDetails &&
    (costDetails.length < 2 ||
      new Set(costDetails.map((item) => item.id)).size !== costDetails.length ||
      costDetails.some((item) => !item.label || !Number.isFinite(item.amount) || item.amount < 0) ||
      Math.abs(costDetails.reduce((sum, item) => sum + item.amount, 0) - costParentAmount!) >
        tolerance)
  )
    return { ok: false, reason: "Reported operating cost lines do not reconcile." };
  if (other < -tolerance) {
    return {
      ok: false,
      reason: "Reported operating expense categories exceed total operating expenses."
    };
  }

  if (signedAccounting)
    return buildSignedStatementFlow(period, {
      tolerance,
      hasGrossStage,
      hasOperating,
      expenses: disclosedExpenses,
      costDetails,
      businessAvailable: !segmentProblem(period),
      adjustmentLabel: revenueAdjustmentLabel
    });

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const node = (
    id: string,
    label: string,
    amount: number,
    tone: FlowTone,
    group: FlowNode["group"]
  ) => {
    const entry: FlowNode = { id, label, amount, tone, group };
    nodes.push(entry);
    return entry;
  };
  const link = (source: string, target: string, value: number, tone: FlowTone) => {
    if (value > 0) links.push({ source, target, value, tone });
  };
  const adjustments = period.revenueAdjustments ?? [];
  const negativeAdjustments = adjustments.filter((item) => item.revenue < 0);
  const revenueBase = m.revenue - negativeAdjustments.reduce((sum, item) => sum + item.revenue, 0);
  const entryNode = negativeAdjustments.length ? "revenue-base" : "revenue";
  if (!segmentProblem(period)) {
    period.segments!.forEach((segment) => {
      node(`segment-${segment.id}`, segment.label, segment.revenue, "revenue", "segment").business =
        segment;
      link(`segment-${segment.id}`, entryNode, segment.revenue, "revenue");
    });
  }
  for (const adjustment of adjustments.filter((item) => item.revenue > 0)) {
    node(
      `adjustment-${adjustment.id}`,
      revenueAdjustmentLabel(adjustment),
      adjustment.revenue,
      "profit",
      "segment"
    );
    link(`adjustment-${adjustment.id}`, entryNode, adjustment.revenue, "profit");
  }
  if (negativeAdjustments.length) {
    node("revenue-base", "Pre-adjustment revenue", revenueBase, "revenue", "revenue-base");
    link("revenue-base", "revenue", m.revenue, "revenue");
    for (const adjustment of negativeAdjustments) {
      node(
        `adjustment-${adjustment.id}`,
        revenueAdjustmentLabel(adjustment),
        -adjustment.revenue,
        "expense",
        "adjustment"
      );
      link("revenue-base", `adjustment-${adjustment.id}`, -adjustment.revenue, "expense");
    }
  }
  node("revenue", "Revenue", m.revenue, "revenue", "main");
  if (hasGrossStage) node("gross", "Gross profit", m.grossProfit!, "profit", "main");
  if (hasOperating) node("operating", "Operating profit", operatingIncome, "profit", "main");
  node("pretax", "Pretax profit", m.pretaxIncome, "profit", "main");
  node(
    "net",
    m.noncontrollingInterestIncome !== undefined ? "Net profit to parent" : "Net profit",
    m.netIncome,
    "profit",
    "main"
  );
  if (hasGrossStage) node("cost", "Cost of revenue", m.costOfRevenue!, "expense", "cost");
  if (!hasOperating)
    node(
      "other-items",
      hasGrossStage ? "Expenses and other items (net)" : "Costs and other items (net)",
      m.expensesAndOtherItems!,
      "expense",
      "opex"
    );
  else if (hasGrossStage)
    node(
      "opex",
      period.operatingExpensesBasis
        ? "Operating expenses and other items (net)"
        : "Operating expenses",
      m.operatingExpenses!,
      "expense",
      "opex"
    );
  else node("operating-costs", "Total operating costs", m.totalOperatingCosts!, "expense", "opex");
  const taxExpense = incomeTax > 0 ? incomeTax : 0;
  const taxBenefit = incomeTax < 0 ? -incomeTax : 0;
  if (taxBenefit > 0) node("tax-benefit", "Tax benefit", taxBenefit, "profit", "tax-benefit");
  else node("tax", "Income tax", taxExpense, "expense", "tax");
  if (!hasOperating) {
    const from = hasGrossStage ? "gross" : "revenue";
    if (hasGrossStage) {
      link("revenue", "gross", m.grossProfit!, "profit");
      link("revenue", "cost", m.costOfRevenue!, "expense");
    }
    link(from, "pretax", m.pretaxIncome, "profit");
    link(from, "other-items", m.expensesAndOtherItems!, "expense");
  } else if (hasGrossStage) {
    link("revenue", "gross", m.grossProfit!, "profit");
    link("revenue", "cost", m.costOfRevenue!, "expense");
    link("gross", "operating", operatingIncome - Math.max(0, operatingAdjustment), "profit");
    link("gross", "opex", m.operatingExpenses!, "expense");
  } else {
    link("revenue", "operating", operatingIncome - Math.max(0, operatingAdjustment), "profit");
    link("revenue", "operating-costs", m.totalOperatingCosts!, "expense");
  }
  if (hasOperating && operatingAdjustment !== 0) {
    node(
      "operating-rounding",
      operatingReconciliation!.label,
      Math.abs(operatingAdjustment),
      operatingAdjustment > 0 ? "profit" : "expense",
      "operating-adjustment"
    );
    if (operatingAdjustment > 0)
      link("operating-rounding", "operating", operatingAdjustment, "profit");
    else
      link(
        hasGrossStage ? "gross" : "revenue",
        "operating-rounding",
        -operatingAdjustment,
        "expense"
      );
  }

  const nonoperating = hasOperating ? m.pretaxIncome - operatingIncome : 0;
  if (!hasOperating) {
    // Non-operating items are already inside "expenses and other items".
  } else if (nonoperating > 0) {
    node("nonoperating", "Non-operating gain (net)", nonoperating, "profit", "nonoperating");
    link("operating", "pretax", operatingIncome, "profit");
    link("nonoperating", "pretax", nonoperating, "profit");
  } else if (nonoperating < 0) {
    node("nonoperating", "Non-operating loss (net)", -nonoperating, "expense", "nonoperating");
    link("operating", "pretax", m.pretaxIncome, "profit");
    link("operating", "nonoperating", -nonoperating, "expense");
  } else {
    link("operating", "pretax", operatingIncome, "profit");
  }
  if (equityMethodIncome !== 0) {
    node(
      "equity",
      equityMethodIncome > 0
        ? "Equity-method income (after tax)"
        : "Equity-method loss (after tax)",
      Math.abs(equityMethodIncome),
      equityMethodIncome > 0 ? "profit" : "expense",
      "equity"
    );
  }
  if (discontinuedOperationsIncome !== 0) {
    node(
      "discontinued",
      discontinuedOperationsIncome > 0
        ? "Discontinued operations (after tax)"
        : "Discontinued operations loss (after tax)",
      Math.abs(discontinuedOperationsIncome),
      discontinuedOperationsIncome > 0 ? "profit" : "expense",
      "discontinued"
    );
  }
  if (afterTaxSubsidiaryIncome !== 0) {
    node(
      "subsidiary",
      afterTaxSubsidiaryIncome > 0
        ? "Unconsolidated subsidiary income (after tax)"
        : "Unconsolidated subsidiary loss (after tax)",
      Math.abs(afterTaxSubsidiaryIncome),
      afterTaxSubsidiaryIncome > 0 ? "profit" : "expense",
      "subsidiary"
    );
  }
  if (noncontrollingInterestIncome !== 0) {
    node(
      "noncontrolling",
      noncontrollingInterestIncome > 0
        ? "Profit to noncontrolling interests"
        : "Loss of noncontrolling interests",
      Math.abs(noncontrollingInterestIncome),
      noncontrollingInterestIncome > 0 ? "expense" : "profit",
      "noncontrolling"
    );
  }
  // Allocate only reported after-tax amounts. Tax benefits and minority losses
  // are incoming flows; minority income is a profit allocation, not a tax or an
  // operating expense. Sources may also cover reported after-tax equity losses.
  if (afterTaxAdjustment)
    node(
      "after-tax-rounding",
      "After-tax source rounding",
      Math.abs(afterTaxAdjustment),
      afterTaxAdjustment > 0 ? "profit" : "expense",
      "after-tax-adjustment"
    );
  const afterTaxSources = [
    { id: "pretax", remaining: m.pretaxIncome - taxExpense },
    { id: "tax-benefit", remaining: taxBenefit },
    { id: "equity", remaining: Math.max(0, equityMethodIncome) },
    { id: "subsidiary", remaining: Math.max(0, afterTaxSubsidiaryIncome) },
    { id: "discontinued", remaining: Math.max(0, discontinuedOperationsIncome) },
    { id: "noncontrolling", remaining: Math.max(0, -noncontrollingInterestIncome) },
    { id: "after-tax-rounding", remaining: Math.max(0, afterTaxAdjustment) }
  ];
  for (const [target, amount] of [
    ["equity", Math.max(0, -equityMethodIncome)],
    ["subsidiary", Math.max(0, -afterTaxSubsidiaryIncome)],
    ["discontinued", Math.max(0, -discontinuedOperationsIncome)],
    ["noncontrolling", Math.max(0, noncontrollingInterestIncome)],
    ["after-tax-rounding", Math.max(0, -afterTaxAdjustment)]
  ] as const) {
    let remaining = amount;
    for (const source of afterTaxSources) {
      const allocated = Math.min(source.remaining, remaining);
      link(source.id, target, allocated, "expense");
      source.remaining -= allocated;
      remaining -= allocated;
    }
  }
  for (const source of afterTaxSources) link(source.id, "net", source.remaining, "profit");
  link("pretax", "tax", taxExpense, "expense");
  for (const cost of costDetails ?? []) {
    node(`detail-${cost.id}`, cost.label, cost.amount, "expense", "detail");
    link(costParent!, `detail-${cost.id}`, cost.amount, "expense");
  }
  if (disclosedExpenses) {
    for (const expense of disclosedExpenses) {
      node(`detail-${expense.id}`, expense.label, expense.amount, "expense", "detail");
      link("opex", `detail-${expense.id}`, expense.amount, "expense");
    }
  } else if (drawExpenseComponents && (rd !== undefined || sga !== undefined)) {
    if (rd !== undefined) {
      node("rd", "Research & development", rd, "expense", "detail");
      link("opex", "rd", rd, "expense");
    }
    if (sga !== undefined) {
      node("sga", "Selling, general & administrative", sga, "expense", "detail");
      link("opex", "sga", sga, "expense");
    }
    if (other > tolerance) {
      node("other-opex", "Other operating items (net)", other, "expense", "detail");
      link("opex", "other-opex", other, "expense");
    }
  }
  return { ok: true, graph: { nodes, links } };
}

export function layoutStatementFlow(graph: StatementFlow) {
  if (graph.signedAccounting) return layoutSignedStatementFlow(graph);
  const revenueBase = graph.nodes.find((node) => node.id === "revenue-base");
  const scale = 350 / Math.max(...graph.nodes.map((node) => node.amount));
  const nodeWidth = 16;
  const hasSegments = graph.nodes.some((node) => node.group === "segment");
  const hasGrossStage = graph.nodes.some((node) => node.id === "gross");
  // Without a reported operating-profit line, pretax profit takes that column.
  const hasOperating = graph.nodes.some((node) => node.id === "operating");
  const anchor = hasOperating ? "operating" : "pretax";
  const mainX: Record<string, number> = hasGrossStage
    ? hasOperating
      ? {
          revenue: revenueBase ? 535 : hasSegments ? 400 : 180,
          gross: revenueBase ? 735 : 625,
          operating: revenueBase ? 920 : 850,
          pretax: revenueBase ? 1100 : 1060,
          net: 1280
        }
      : {
          revenue: revenueBase ? 535 : hasSegments ? 400 : 180,
          gross: revenueBase ? 735 : 625,
          pretax: revenueBase ? 920 : 850,
          net: revenueBase ? 1100 : 1060
        }
    : hasOperating
      ? {
          revenue: revenueBase ? 535 : hasSegments ? 400 : 180,
          operating: revenueBase ? 760 : hasSegments ? 645 : 475,
          pretax: revenueBase ? 985 : hasSegments ? 870 : 750,
          net: revenueBase ? 1210 : hasSegments ? 1095 : 1025
        }
      : {
          revenue: revenueBase ? 535 : hasSegments ? 400 : 180,
          pretax: revenueBase ? 760 : hasSegments ? 645 : 475,
          net: revenueBase ? 985 : hasSegments ? 870 : 750
        };
  const amountHeight = (id: string) =>
    (graph.nodes.find((node) => node.id === id)?.amount ?? 0) * scale;
  const nonoperating = graph.nodes.find((node) => node.group === "nonoperating");
  const tax = graph.nodes.find((node) => node.group === "tax");
  const taxBenefit = graph.nodes.find((node) => node.group === "tax-benefit");
  const equity = graph.nodes.find((node) => node.id === "equity");
  const subsidiary = graph.nodes.find((node) => node.id === "subsidiary");
  const noncontrolling = graph.nodes.find((node) => node.id === "noncontrolling");
  const discontinued = graph.nodes.find((node) => node.id === "discontinued");
  const costParent = graph.nodes.find((node) => node.group === "opex");
  const operatingRounding = graph.nodes.find((node) => node.id === "operating-rounding");
  const afterTaxRounding = graph.nodes.find((node) => node.id === "after-tax-rounding");
  const positiveNonoperatingHeight =
    nonoperating?.tone === "profit" ? amountHeight("nonoperating") : 0;

  // Gains enter from a distinct upper lane and occupy the upper incoming port.
  // The main route is offset by their actual heights, never by inflated minimum
  // ribbon widths. Label clearance, rather than a fixed canvas corner, controls
  // the minimum distance between an upper source and its main accounting stage.
  const upperSourceY = 260;
  let nextNetSourceY = upperSourceY;
  const netSourceYs = new Map<string, number>();
  let netSourceBottom = 0;
  for (const source of [
    taxBenefit,
    equity?.tone === "profit" ? equity : undefined,
    subsidiary?.tone === "profit" ? subsidiary : undefined,
    discontinued?.tone === "profit" ? discontinued : undefined,
    noncontrolling?.tone === "profit" ? noncontrolling : undefined,
    afterTaxRounding?.tone === "profit" ? afterTaxRounding : undefined
  ]) {
    if (!source) continue;
    netSourceYs.set(source.id, nextNetSourceY);
    netSourceBottom = nextNetSourceY + source.amount * scale;
    nextNetSourceY = netSourceBottom + 115;
  }
  const netGainHeight =
    (taxBenefit?.amount ?? 0) * scale +
    (equity?.tone === "profit" ? equity.amount * scale : 0) +
    (subsidiary?.tone === "profit" ? subsidiary.amount * scale : 0) +
    (discontinued?.tone === "profit" ? discontinued.amount * scale : 0) +
    (noncontrolling?.tone === "profit" ? noncontrolling.amount * scale : 0) +
    (afterTaxRounding?.tone === "profit" ? afterTaxRounding.amount * scale : 0);
  const operatingY = Math.max(
    480,
    operatingRounding?.tone === "profit"
      ? upperSourceY +
          operatingRounding.amount * scale +
          115 +
          amountHeight("revenue") / 2 -
          amountHeight("operating") / 2 -
          45
      : 0,
    nonoperating?.tone === "profit" ? upperSourceY + positiveNonoperatingHeight + 115 : 0,
    Math.max(360, netSourceBottom + 115) + positiveNonoperatingHeight + 40
  );
  const operatingCenter = operatingY + amountHeight(anchor) / 2;
  const grossCenter = operatingCenter + 70;
  const revenueCenter = hasGrossStage ? grossCenter + 20 : operatingCenter + 45;
  const mainY: Record<string, number> = {
    revenue: revenueCenter - amountHeight("revenue") / 2,
    gross: grossCenter - amountHeight("gross") / 2,
    operating: operatingY,
    pretax: hasOperating ? operatingY - positiveNonoperatingHeight - 40 : operatingY,
    net: hasOperating
      ? operatingY - positiveNonoperatingHeight - 65 - netGainHeight
      : operatingY - 25 - netGainHeight
  };
  const mainBottom = (id: string) => mainY[id] + amountHeight(id);
  const nonoperatingY =
    nonoperating?.tone === "profit"
      ? upperSourceY
      : Math.max(mainBottom("operating"), mainBottom("pretax")) + 105;
  const taxY = Math.max(mainBottom("net") + 100, mainBottom("pretax") + 80);
  const operatingExpenseY = Math.max(
    hasGrossStage ? mainBottom("gross") + 100 : mainBottom("revenue") + 100,
    mainBottom(anchor) + 130,
    nonoperating?.tone === "expense" ? nonoperatingY + amountHeight("nonoperating") + 115 : 0
  );
  const costY = Math.max(mainBottom("revenue") + 90, mainBottom("gross") + 105);
  const operatingRoundingY =
    operatingRounding?.tone === "profit"
      ? upperSourceY
      : operatingExpenseY + (costParent?.amount ?? 0) * scale + 115;
  const equityY =
    equity?.tone === "profit"
      ? netSourceYs.get("equity")!
      : taxY + (tax?.amount ?? 0) * scale + 110;
  const subsidiaryY =
    subsidiary?.tone === "profit"
      ? netSourceYs.get("subsidiary")!
      : (equity?.tone === "expense"
          ? equityY + equity.amount * scale
          : taxY + (tax?.amount ?? 0) * scale) + 110;
  const discontinuedY =
    discontinued?.tone === "profit"
      ? netSourceYs.get("discontinued")!
      : (subsidiary?.tone === "expense"
          ? subsidiaryY + subsidiary.amount * scale
          : equity?.tone === "expense"
            ? equityY + equity.amount * scale
            : taxY + (tax?.amount ?? 0) * scale) + 110;
  const noncontrollingY =
    noncontrolling?.tone === "profit"
      ? netSourceYs.get("noncontrolling")!
      : (discontinued?.tone === "expense"
          ? discontinuedY + discontinued.amount * scale
          : subsidiary?.tone === "expense"
            ? subsidiaryY + subsidiary.amount * scale
            : equity?.tone === "expense"
              ? equityY + equity.amount * scale
              : taxY + (tax?.amount ?? 0) * scale) + 110;
  const afterTaxRoundingY =
    afterTaxRounding?.tone === "profit"
      ? netSourceYs.get("after-tax-rounding")!
      : (noncontrolling?.tone === "expense"
          ? noncontrollingY + noncontrolling.amount * scale
          : discontinued?.tone === "expense"
            ? discontinuedY + discontinued.amount * scale
            : subsidiary?.tone === "expense"
              ? subsidiaryY + subsidiary.amount * scale
              : equity?.tone === "expense"
                ? equityY + equity.amount * scale
                : taxY + (tax?.amount ?? 0) * scale) + 110;
  let detailY = Math.max(
    operatingExpenseY + 5,
    tax ? taxY + tax.amount * scale + 115 : 0,
    equity?.tone === "expense" ? equityY + equity.amount * scale + 115 : 0,
    subsidiary?.tone === "expense" ? subsidiaryY + subsidiary.amount * scale + 115 : 0,
    discontinued?.tone === "expense" ? discontinuedY + discontinued.amount * scale + 115 : 0,
    noncontrolling?.tone === "expense" ? noncontrollingY + noncontrolling.amount * scale + 115 : 0,
    afterTaxRounding?.tone === "expense"
      ? afterTaxRoundingY + afterTaxRounding.amount * scale + 115
      : 0
  );
  let adjustmentY = Math.max(
    costY + 50,
    revenueCenter + ((revenueBase?.amount ?? 0) * scale) / 2 + 110
  );
  const nodes: PositionedNode[] = graph.nodes.map((node) => {
    const height = node.amount * scale;
    let x: number;
    let y: number;
    if (node.group === "main") {
      x = mainX[node.id];
      y = mainY[node.id];
    } else if (node.group === "segment") {
      x = 230;
      y = 0; // Filled after the actual downstream extent is known.
    } else if (node.group === "cost") {
      x = mainX.gross;
      y = costY;
    } else if (node.group === "opex") {
      x = hasOperating ? mainX.operating : mainX.pretax;
      y = operatingExpenseY;
    } else if (node.group === "tax") {
      x = mainX.net;
      y = taxY;
    } else if (node.group === "tax-benefit") {
      x = mainX.pretax;
      y = netSourceYs.get(node.id)!;
    } else if (node.group === "equity") {
      x = node.tone === "profit" ? mainX.pretax : mainX.net;
      y = equityY;
    } else if (node.group === "subsidiary") {
      x = node.tone === "profit" ? mainX.pretax : mainX.net;
      y = subsidiaryY;
    } else if (node.group === "discontinued") {
      x = node.tone === "profit" ? mainX.pretax : mainX.net;
      y = discontinuedY;
    } else if (node.group === "noncontrolling") {
      x = node.tone === "profit" ? mainX.pretax : mainX.net;
      y = noncontrollingY;
    } else if (node.group === "nonoperating") {
      x = node.tone === "profit" ? mainX.operating : mainX.pretax;
      y = nonoperatingY;
    } else if (node.group === "operating-adjustment") {
      x = node.tone === "profit" ? mainX.revenue : mainX.operating;
      y = operatingRoundingY;
    } else if (node.group === "after-tax-adjustment") {
      x = node.tone === "profit" ? mainX.pretax : mainX.net;
      y = afterTaxRoundingY;
    } else if (node.group === "revenue-base") {
      x = 350;
      y = revenueCenter - 20 - height / 2;
    } else if (node.group === "adjustment") {
      x = 510;
      y = adjustmentY;
      adjustmentY += Math.max(height, 55) + 90;
    } else {
      x = mainX.net;
      y = detailY;
      detailY += Math.max(height, wrapLabel(node.label, 20).length * 20 + 47) + 26;
    }
    return { ...node, x, y, height };
  });
  const sources = nodes.filter((node) => node.group === "segment");
  const sourceRows = sources.map((node) =>
    Math.max(node.height, wrapLabel(node.label, 17).length * 20 + (node.business ? 78 : 50))
  );
  const naturalSourceHeight = sourceRows.reduce((sum, height) => sum + height, 0);
  const details = nodes.filter((node) => node.group === "detail");
  const detailBottom = Math.max(0, ...details.map((node) => node.y + Math.max(node.height, 80)));
  const sourceTop = 240;
  const sourceBottom = Math.max(
    hasGrossStage
      ? costY + amountHeight("cost")
      : operatingExpenseY + (costParent?.amount ?? 0) * scale,
    operatingRounding?.tone === "expense"
      ? operatingRoundingY + operatingRounding.amount * scale
      : 0,
    detailBottom - Math.max(0, details.length - 3) * 40,
    sourceTop + naturalSourceHeight + Math.max(0, sources.length - 1) * 18
  );
  const sourceGap =
    sources.length > 1
      ? (sourceBottom - sourceTop - naturalSourceHeight) / (sources.length - 1)
      : 0;
  let sourceCursor =
    sources.length === 1 ? (sourceTop + sourceBottom - naturalSourceHeight) / 2 : sourceTop;
  sources.forEach((node, index) => {
    node.y = sourceCursor + (sourceRows[index] - node.height) / 2;
    sourceCursor += sourceRows[index] + sourceGap;
  });
  const lookup = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<FlowLink, number>();
  const incoming = new Map<FlowLink, number>();
  // Match port order to the physical ordering of the adjacent nodes. In
  // particular, an upper gain must not feed the bottom of a main node through
  // an unrelated operating ribbon.
  for (const node of nodes) {
    for (const [ownEnd, adjacentEnd, offsets] of [
      ["source", "target", outgoing],
      ["target", "source", incoming]
    ] as const) {
      let offset = 0;
      const adjacentLinks = graph.links
        .filter((link) => link[ownEnd] === node.id)
        .sort((a, b) => {
          const first = lookup.get(a[adjacentEnd])!;
          const second = lookup.get(b[adjacentEnd])!;
          return first.y + first.height / 2 - second.y - second.height / 2;
        });
      for (const link of adjacentLinks) {
        offsets.set(link, offset);
        offset += link.value * scale;
      }
    }
  }
  const links: PositionedLink[] = graph.links.map((link) => {
    const source = lookup.get(link.source)!;
    const target = lookup.get(link.target)!;
    const width = link.value * scale;
    const sy = source.y + (outgoing.get(link) ?? 0);
    const ty = target.y + (incoming.get(link) ?? 0);
    const sx = source.x + nodeWidth;
    const tx = target.x;
    const bend = (tx - sx) * 0.52;
    const path = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty} L ${tx} ${ty + width} C ${tx - bend} ${ty + width}, ${sx + bend} ${sy + width}, ${sx} ${sy + width} Z`;
    const annotationPath = `M ${sx} ${sy + width / 2} C ${sx + bend} ${sy + width / 2}, ${tx - bend} ${ty + width / 2}, ${tx} ${ty + width / 2}`;
    return { ...link, width, path, annotationPath };
  });
  const height =
    Math.max(
      960,
      ...nodes.map((node) =>
        node.group === "cost" || node.group === "nonoperating"
          ? node.y + node.height + 95
          : node.y + Math.max(node.height, 80)
      )
    ) + 110;
  // Generic cost captions can be longer than the featured-company labels.
  // Reserve a conservative 17 px per character at the actual detail font size,
  // keeping labels and exports inside the canvas without changing flow scale.
  const rightLabelExtent = Math.max(
    0,
    ...nodes
      .filter(
        (node) =>
          node.group === "detail" ||
          node.group === "tax" ||
          (["equity", "subsidiary", "discontinued", "noncontrolling"].includes(node.group) &&
            node.tone === "expense")
      )
      .map(
        (node) =>
          node.x + 29 + Math.max(...wrapLabel(node.label, 20).map((line) => line.length)) * 17 + 24
      )
  );
  return {
    nodes,
    links,
    scale,
    nodeWidth,
    width: Math.max(hasGrossStage && hasOperating ? 1480 : mainX.net + 210, rightLabelExtent),
    height
  };
}

export function shortMoney(value: number) {
  const magnitude = Math.abs(value);
  const [unit, suffix] =
    magnitude >= 1e12
      ? [1e12, "T"]
      : magnitude >= 1e9
        ? [1e9, "B"]
        : magnitude >= 1e6
          ? [1e6, "M"]
          : [1, ""];
  return `${value < 0 ? "−" : ""}$${(magnitude / unit).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
}

export function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function businessGrossMargin(segment: RevenueSegment) {
  if (
    segment.grossProfit === undefined ||
    !segment.grossProfitSource ||
    !Number.isFinite(segment.grossProfit) ||
    !Number.isFinite(segment.revenue) ||
    segment.revenue <= 0
  )
    return "—";
  const ratio = segment.grossProfit / segment.revenue;
  if (!Number.isFinite(ratio)) return "—";
  if (ratio > 0 && ratio < 0.001) return "<0.1%";
  if (ratio < 0 && ratio > -0.001) return ">−0.1%";
  return percent(ratio).replace("-", "−");
}

export function wrapLabel(label: string, maxLength = 22) {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= maxLength) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}
