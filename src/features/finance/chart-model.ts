import type { FinancialPeriod, RevenueSegment } from "./types";

export type RevenueSeries = { id: string; label: string };
export type RevenueHistory = {
  series: RevenueSeries[];
  periods: { period: FinancialPeriod; available: boolean; reason?: string }[];
};

// A single scale is used for every node and ribbon. Never inflate thin branches.
export type FlowTone = "revenue" | "profit" | "expense";
export type FlowNode = {
  id: string;
  label: string;
  amount: number;
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
    | "revenue-base"
    | "adjustment";
};
export type FlowLink = { source: string; target: string; value: number; tone: FlowTone };
export type StatementFlow = { nodes: FlowNode[]; links: FlowLink[] };
export type FlowResult = { ok: true; graph: StatementFlow } | { ok: false; reason: string };
export type PositionedNode = FlowNode & { x: number; y: number; height: number };
export type PositionedLink = FlowLink & { path: string; width: number; annotationPath: string };

export function accountingTolerance(revenue: number) {
  return Math.max(0.000001, Math.abs(revenue) * 1e-9);
}

export function segmentProblem(period: FinancialPeriod): string | undefined {
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

export function buildRevenueHistory(periods: FinancialPeriod[]): RevenueHistory {
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

export function buildStatementFlow(period: FinancialPeriod): FlowResult {
  const m = period.metrics;
  if (period.grossProfitAdjustments?.some((item) => item.amount !== 0))
    return {
      ok: false,
      reason:
        "This filing reports separate gross-profit adjustments. Use the statement table and source filing; this flow chart does not model those adjustments."
    };
  const { equityMethodIncome = 0, incomeTax, ...positiveMetrics } = m;
  if (Object.values(m).some((value) => value !== undefined && !Number.isFinite(value))) {
    return { ok: false, reason: "This statement contains non-finite financial values." };
  }
  if (
    m.revenue <= 0 ||
    Object.values(positiveMetrics).some((value) => value !== undefined && value < 0) ||
    m.pretaxIncome < incomeTax
  ) {
    return {
      ok: false,
      reason:
        "This statement includes a negative profit, a post-tax loss before equity income, or another unsupported negative line item. A positive-flow Sankey would misrepresent it; use the statement table and original filing."
    };
  }
  const tolerance = accountingTolerance(m.revenue);
  const identities = [
    [m.revenue, m.costOfRevenue + m.grossProfit, "Revenue, cost of revenue, and gross profit"],
    [m.grossProfit, m.operatingExpenses + m.operatingIncome, "Gross profit and operating items"],
    [
      m.pretaxIncome + equityMethodIncome,
      m.incomeTax + m.netIncome,
      "Pretax profit, income tax, after-tax equity income, and net profit"
    ]
  ] as const;
  for (const [total, parts, label] of identities) {
    if (Math.abs(total - parts) > tolerance) {
      return { ok: false, reason: `${label} do not reconcile. No balancing figures are invented.` };
    }
  }
  const rd = m.researchAndDevelopment;
  const sga = m.sellingGeneralAndAdministrative;
  const other = m.operatingExpenses - (rd ?? 0) - (sga ?? 0);
  const disclosedExpenses = period.operatingExpenseDetails;
  if (
    disclosedExpenses &&
    (!disclosedExpenses.length ||
      disclosedExpenses.some((item) => !Number.isFinite(item.amount) || item.amount < 0) ||
      Math.abs(
        disclosedExpenses.reduce((sum, item) => sum + item.amount, 0) - m.operatingExpenses
      ) > tolerance)
  )
    return { ok: false, reason: "Disclosed operating expense components do not reconcile." };
  if (other < -tolerance) {
    return {
      ok: false,
      reason: "Reported operating expense categories exceed total operating expenses."
    };
  }

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const node = (
    id: string,
    label: string,
    amount: number,
    tone: FlowTone,
    group: FlowNode["group"]
  ) => {
    nodes.push({ id, label, amount, tone, group });
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
      node(`segment-${segment.id}`, segment.label, segment.revenue, "revenue", "segment");
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
  node("gross", "Gross profit", m.grossProfit, "profit", "main");
  node("operating", "Operating profit", m.operatingIncome, "profit", "main");
  node("pretax", "Pretax profit", m.pretaxIncome, "profit", "main");
  node("net", "Net profit", m.netIncome, "profit", "main");
  node("cost", "Cost of revenue", m.costOfRevenue, "expense", "cost");
  node("opex", "Operating expenses", m.operatingExpenses, "expense", "opex");
  const taxExpense = incomeTax > 0 ? incomeTax : 0;
  const taxBenefit = incomeTax < 0 ? -incomeTax : 0;
  if (taxBenefit > 0) node("tax-benefit", "Tax benefit", taxBenefit, "profit", "tax-benefit");
  else node("tax", "Income tax", taxExpense, "expense", "tax");
  link("revenue", "gross", m.grossProfit, "profit");
  link("revenue", "cost", m.costOfRevenue, "expense");
  link("gross", "operating", m.operatingIncome, "profit");
  link("gross", "opex", m.operatingExpenses, "expense");

  const nonoperating = m.pretaxIncome - m.operatingIncome;
  if (nonoperating > 0) {
    node("nonoperating", "Non-operating gain (net)", nonoperating, "profit", "nonoperating");
    link("operating", "pretax", m.operatingIncome, "profit");
    link("nonoperating", "pretax", nonoperating, "profit");
  } else if (nonoperating < 0) {
    node("nonoperating", "Non-operating loss (net)", -nonoperating, "expense", "nonoperating");
    link("operating", "pretax", m.pretaxIncome, "profit");
    link("operating", "nonoperating", -nonoperating, "expense");
  } else {
    link("operating", "pretax", m.operatingIncome, "profit");
  }
  // A tax benefit is an incoming reported value, not a negative-width expense.
  // When an after-tax equity loss exceeds pretax profit, the excess is met by
  // part of the tax benefit. This splits reported flows without altering them.
  const afterTaxPretax = m.pretaxIncome - taxExpense;
  const equityLoss = equityMethodIncome < 0 ? -equityMethodIncome : 0;
  const pretaxToEquity = Math.min(afterTaxPretax, equityLoss);
  const benefitToEquity = equityLoss - pretaxToEquity;
  link("pretax", "net", afterTaxPretax - pretaxToEquity, "profit");
  link("pretax", "tax", taxExpense, "expense");
  if (taxBenefit > 0) {
    link("tax-benefit", "net", taxBenefit - benefitToEquity, "profit");
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
    if (equityMethodIncome > 0) link("equity", "net", equityMethodIncome, "profit");
    else {
      link("pretax", "equity", pretaxToEquity, "expense");
      link("tax-benefit", "equity", benefitToEquity, "expense");
    }
  }
  if (disclosedExpenses) {
    for (const expense of disclosedExpenses) {
      node(`detail-${expense.id}`, expense.label, expense.amount, "expense", "detail");
      link("opex", `detail-${expense.id}`, expense.amount, "expense");
    }
  } else if (rd !== undefined || sga !== undefined) {
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
  const revenueBase = graph.nodes.find((node) => node.id === "revenue-base");
  const scale = 350 / Math.max(...graph.nodes.map((node) => node.amount));
  const nodeWidth = 16;
  const hasSegments = graph.nodes.some((node) => node.group === "segment");
  const mainX: Record<string, number> = {
    revenue: revenueBase ? 535 : hasSegments ? 400 : 180,
    gross: revenueBase ? 735 : 625,
    operating: revenueBase ? 920 : 850,
    pretax: revenueBase ? 1100 : 1060,
    net: 1280
  };
  const amountHeight = (id: string) =>
    (graph.nodes.find((node) => node.id === id)?.amount ?? 0) * scale;
  const nonoperating = graph.nodes.find((node) => node.group === "nonoperating");
  const tax = graph.nodes.find((node) => node.group === "tax");
  const taxBenefit = graph.nodes.find((node) => node.group === "tax-benefit");
  const equity = graph.nodes.find((node) => node.id === "equity");
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
  for (const source of [taxBenefit, equity?.tone === "profit" ? equity : undefined]) {
    if (!source) continue;
    netSourceYs.set(source.id, nextNetSourceY);
    netSourceBottom = nextNetSourceY + source.amount * scale;
    nextNetSourceY = netSourceBottom + 115;
  }
  const netGainHeight =
    (taxBenefit?.amount ?? 0) * scale + (equity?.tone === "profit" ? equity.amount * scale : 0);
  const operatingY = Math.max(
    480,
    nonoperating?.tone === "profit" ? upperSourceY + positiveNonoperatingHeight + 115 : 0,
    Math.max(360, netSourceBottom + 115) + positiveNonoperatingHeight + 40
  );
  const operatingCenter = operatingY + amountHeight("operating") / 2;
  const grossCenter = operatingCenter + 70;
  const revenueCenter = grossCenter + 20;
  const mainY: Record<string, number> = {
    revenue: revenueCenter - amountHeight("revenue") / 2,
    gross: grossCenter - amountHeight("gross") / 2,
    operating: operatingY,
    pretax: operatingY - positiveNonoperatingHeight - 40,
    net: operatingY - positiveNonoperatingHeight - 65 - netGainHeight
  };
  const mainBottom = (id: string) => mainY[id] + amountHeight(id);
  const nonoperatingY =
    nonoperating?.tone === "profit"
      ? upperSourceY
      : Math.max(mainBottom("operating"), mainBottom("pretax")) + 105;
  const taxY = Math.max(mainBottom("net") + 100, mainBottom("pretax") + 80);
  const operatingExpenseY = Math.max(
    mainBottom("gross") + 100,
    mainBottom("operating") + 130,
    nonoperating?.tone === "expense" ? nonoperatingY + amountHeight("nonoperating") + 115 : 0
  );
  const costY = Math.max(mainBottom("revenue") + 90, mainBottom("gross") + 105);
  const equityY =
    equity?.tone === "profit"
      ? netSourceYs.get("equity")!
      : taxY + (tax?.amount ?? 0) * scale + 110;
  let detailY = Math.max(
    operatingExpenseY + 5,
    tax ? taxY + tax.amount * scale + 115 : 0,
    equity?.tone === "expense" ? equityY + equity.amount * scale + 115 : 0
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
      x = 185;
      y = 0; // Filled after the actual downstream extent is known.
    } else if (node.group === "cost") {
      x = mainX.gross;
      y = costY;
    } else if (node.group === "opex") {
      x = mainX.operating;
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
    } else if (node.group === "nonoperating") {
      x = node.tone === "profit" ? mainX.operating : mainX.pretax;
      y = nonoperatingY;
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
    Math.max(node.height, wrapLabel(node.label, 17).length * 20 + 50)
  );
  const naturalSourceHeight = sourceRows.reduce((sum, height) => sum + height, 0);
  const details = nodes.filter((node) => node.group === "detail");
  const detailBottom = Math.max(0, ...details.map((node) => node.y + Math.max(node.height, 80)));
  const sourceTop = 240;
  const sourceBottom = Math.max(
    costY + amountHeight("cost"),
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
  return { nodes, links, scale, nodeWidth, width: 1480, height };
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

export function wrapLabel(label: string, maxLength = 22) {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const last = lines.at(-1);
    if (last && `${last} ${word}`.length <= maxLength) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}
