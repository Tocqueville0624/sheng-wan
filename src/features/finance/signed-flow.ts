import type {
  FlowStatementPeriod,
  StatementChartPeriod,
  RevenueSegment,
  StatementLine
} from "./types";
import type {
  FlowLink,
  FlowNode,
  FlowResult,
  FlowTone,
  PositionedLink,
  PositionedNode,
  StatementFlow
} from "./chart-model";
import { wrapLabel } from "./chart-model";
import { afterTaxTransactionLabel } from "./after-tax-transaction";

/**
 * An accounting identity x + gains - expenses = y is represented as
 * x+ + gains + y- = expenses + x- + y+. Negative subtotals retain their
 * reported signs and act as shortfalls, never as additional revenue or cash.
 * Positive statements keep their existing layout. Every allocation and ribbon
 * uses exact dollars; negative-stage ribbons may run back toward earlier costs.
 */
export function buildSignedStatementFlow(
  period: StatementChartPeriod,
  options: {
    tolerance: number;
    hasGrossStage: boolean;
    hasOperating: boolean;
    expenses?: StatementLine[];
    costDetails?: StatementLine[];
    businessAvailable: boolean;
    adjustmentLabel: (item: RevenueSegment) => string;
  }
): FlowResult {
  const m = period.metrics;
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const node = (
    id: string,
    label: string,
    amount: number,
    tone: FlowTone,
    group: FlowNode["group"],
    stage: number,
    signedAmount?: number
  ) => {
    const entry: FlowNode = { id, label, amount, tone, group, stage };
    if (signedAmount !== undefined) entry.signedAmount = signedAmount;
    nodes.push(entry);
    return entry;
  };
  const link = (source: string, target: string, value: number, tone: FlowTone) => {
    if (value > 0) links.push({ source, target, value, tone });
  };
  const income = (id: string, positive: string, negative: string, value: number, stage: number) =>
    node(
      id,
      value < 0 ? negative : positive,
      Math.abs(value),
      value < 0 ? "expense" : "profit",
      "main",
      stage,
      value
    );
  const revenue = node("revenue", "Revenue", m.revenue, "revenue", "main", 1);
  const adjustments = period.revenueAdjustments ?? [];
  const negativeRevenue = adjustments.filter((item) => item.revenue < 0);
  const entry = negativeRevenue.length ? "revenue-base" : revenue.id;
  if (options.businessAvailable)
    for (const business of period.segments!) {
      node(
        `segment-${business.id}`,
        business.label,
        business.revenue,
        "revenue",
        "segment",
        0
      ).business = business;
      link(`segment-${business.id}`, entry, business.revenue, "revenue");
    }
  for (const adjustment of adjustments.filter((item) => item.revenue > 0)) {
    const id = `adjustment-${adjustment.id}`;
    node(id, options.adjustmentLabel(adjustment), adjustment.revenue, "profit", "segment", 0);
    link(id, entry, adjustment.revenue, "profit");
  }
  if (negativeRevenue.length) {
    const base = m.revenue - negativeRevenue.reduce((sum, item) => sum + item.revenue, 0);
    node(entry, "Pre-adjustment revenue", base, "revenue", "revenue-base", 0.65);
    link(entry, revenue.id, m.revenue, "revenue");
    for (const adjustment of negativeRevenue) {
      const id = `adjustment-${adjustment.id}`;
      node(
        id,
        options.adjustmentLabel(adjustment),
        -adjustment.revenue,
        "expense",
        "adjustment",
        1
      );
      link(entry, id, -adjustment.revenue, "expense");
    }
  }
  let stage = 1;
  let previous = revenue;
  const allocate = (
    inputs: { id: string; amount: number }[],
    outputs: { id: string; amount: number; tone: FlowTone }[]
  ) => {
    const totalIn = inputs.reduce((sum, item) => sum + item.amount, 0);
    const totalOut = outputs.reduce((sum, item) => sum + item.amount, 0);
    if (Math.abs(totalIn - totalOut) > options.tolerance) return false;
    const remaining = inputs.map((item) => ({ ...item }));
    for (const output of outputs) {
      let amount = output.amount;
      for (const input of remaining) {
        const take = Math.min(amount, input.amount);
        link(input.id, output.id, take, output.tone);
        input.amount -= take;
        amount -= take;
      }
      if (amount > options.tolerance) return false;
    }
    return remaining.every((item) => item.amount <= options.tolerance);
  };
  const transition = (next: FlowNode, gains: FlowNode[], expenses: FlowNode[]) => {
    const x = previous.signedAmount ?? previous.amount;
    const y = next.signedAmount ?? next.amount;
    const inputs = [
      ...(x > 0 ? [{ id: previous.id, amount: x }] : []),
      ...gains.map((item) => ({ id: item.id, amount: item.amount })),
      ...(y < 0 ? [{ id: next.id, amount: -y }] : [])
    ];
    // Cover the previous shortfall first, then expenses, then the next profit.
    const outputs = [
      ...(x < 0 ? [{ id: previous.id, amount: -x, tone: "expense" as const }] : []),
      ...expenses.map((item) => ({ id: item.id, amount: item.amount, tone: item.tone })),
      ...(y > 0 ? [{ id: next.id, amount: y, tone: "profit" as const }] : [])
    ];
    const valid = allocate(inputs, outputs);
    previous = next;
    return valid;
  };
  const effect = (
    id: string,
    label: string,
    amount: number,
    group: FlowNode["group"],
    column: number
  ) => node(id, label, Math.abs(amount), amount > 0 ? "profit" : "expense", group, column, amount);
  const stageEffects = (
    amount: number,
    id: string,
    label: string,
    group: FlowNode["group"],
    column: number
  ) => {
    if (!amount) return { gains: [] as FlowNode[], expenses: [] as FlowNode[] };
    const item = effect(id, label, amount, group, column);
    return { gains: amount > 0 ? [item] : [], expenses: amount < 0 ? [item] : [] };
  };
  if (period.directNetItems) {
    const proof = period.directNetItems;
    const consolidated = income(
      "consolidated-net",
      "Consolidated net profit",
      "Consolidated net loss",
      proof.consolidated.amount,
      ++stage
    );
    const cost = node(
      "total-expenses",
      "Total expenses (including interest)",
      proof.expenses.amount,
      "expense",
      "opex",
      stage
    );
    const parts = proof.gains.map((item) =>
      stageEffects(
        item.amount,
        `direct-net-item-${item.id}`,
        item.label,
        "direct-net-item",
        stage - 0.5
      )
    );
    if (
      !transition(
        consolidated,
        parts.flatMap((p) => p.gains),
        [cost, ...parts.flatMap((p) => p.expenses)]
      )
    )
      return { ok: false, reason: "The reported direct net-income stage does not reconcile." };
    const net = income(
      "net",
      "Net profit to parent",
      "Net loss to parent",
      proof.parent.amount,
      ++stage
    );
    const attribution = stageEffects(
      -proof.noncontrolling.amount,
      "noncontrolling",
      proof.noncontrolling.label,
      "noncontrolling",
      proof.noncontrolling.amount < 0 ? stage - 0.5 : stage
    );
    for (const item of [...attribution.gains, ...attribution.expenses])
      item.signedAmount = proof.noncontrolling.amount;
    if (!transition(net, attribution.gains, attribution.expenses))
      return {
        ok: false,
        reason: "The reported direct net-income attribution does not reconcile."
      };
  } else {
    const m = period.metrics as FlowStatementPeriod["metrics"];
    if (options.hasGrossStage) {
      const gross = income("gross", "Gross profit", "Gross loss", m.grossProfit!, ++stage);
      const cost = node("cost", "Cost of revenue", m.costOfRevenue!, "expense", "cost", stage);
      const grossCosts =
        period.grossOperatingItems?.grossCosts
          .filter((item) => item.amount > 0)
          .map((item) =>
            node(
              `gross-cost-${item.id}`,
              `${item.label} (cost of sales)`,
              item.amount,
              "expense",
              "gross-cost-item",
              stage
            )
          ) ?? [];
      if (!transition(gross, [], [cost, ...grossCosts]))
        return { ok: false, reason: "The signed gross-profit stage does not reconcile." };
    }
    if (options.hasOperating) {
      const operating = income(
        "operating",
        "Operating profit",
        "Operating loss",
        m.operatingIncome!,
        ++stage
      );
      const cost = node(
        options.hasGrossStage ? "opex" : "operating-costs",
        options.hasGrossStage
          ? period.grossOperatingItems
            ? period.grossOperatingItems.operatingCosts.some((item) => item.amount < 0)
              ? "Operating expenses (before reversals)"
              : "Operating expenses"
            : period.operatingExpensesBasis
              ? "Operating expenses and other items (net)"
              : "Operating expenses"
          : "Total operating costs",
        options.hasGrossStage
          ? period.grossOperatingItems
            ? period.grossOperatingItems.operatingCosts.reduce(
                (sum, item) => sum + Math.max(0, item.amount),
                0
              )
            : m.operatingExpenses!
          : m.totalOperatingCosts!,
        "expense",
        "opex",
        stage
      );
      const rounding = stageEffects(
        period.operatingReconciliation?.amount ?? 0,
        "operating-rounding",
        "Source rounding",
        "operating-adjustment",
        stage - 0.5
      );
      const operatingItems =
        period.operatingItems?.items
          .filter((item) => item.effect === "gain")
          .map((item) =>
            stageEffects(
              item.amount,
              `operating-item-${item.id}`,
              item.label,
              "operating-item",
              stage - 0.5
            )
          ) ?? [];
      const reversals =
        period.grossOperatingItems?.operatingCosts
          .filter((item) => item.amount < 0)
          .map((item) =>
            stageEffects(
              -item.amount,
              `operating-reversal-${item.id}`,
              item.label,
              "operating-item",
              stage - 0.5
            )
          ) ?? [];
      if (
        !transition(
          operating,
          [
            ...rounding.gains,
            ...operatingItems.flatMap((item) => item.gains),
            ...reversals.flatMap((item) => item.gains)
          ],
          [cost, ...rounding.expenses, ...operatingItems.flatMap((item) => item.expenses)]
        )
      )
        return { ok: false, reason: "The signed operating stage does not reconcile." };
      const details = options.hasGrossStage
        ? period.grossOperatingItems
          ? period.grossOperatingItems.operatingCosts.filter((item) => item.amount > 0)
          : options.expenses
        : options.costDetails;
      if (details)
        for (const detail of details) {
          const id = `expense-${detail.id}`;
          node(id, detail.label, detail.amount, "expense", "detail", stage + 1);
          link(cost.id, id, detail.amount, "expense");
        }
    }
    const pretax = income("pretax", "Pretax profit", "Pretax loss", m.pretaxIncome, ++stage);
    if (options.hasOperating) {
      const delta = m.pretaxIncome - m.operatingIncome!;
      const other = stageEffects(
        delta,
        "nonoperating",
        delta < 0 ? "Non-operating loss (net)" : "Non-operating gain (net)",
        "nonoperating",
        stage - 0.5
      );
      if (!transition(pretax, other.gains, other.expenses))
        return { ok: false, reason: "The signed pretax stage does not reconcile." };
    } else {
      const other = node(
        "other-items",
        options.hasGrossStage ? "Expenses and other items (net)" : "Costs and other items (net)",
        m.expensesAndOtherItems!,
        "expense",
        "opex",
        stage
      );
      if (!transition(pretax, [], [other]))
        return { ok: false, reason: "The signed direct pretax stage does not reconcile." };
      if (options.costDetails)
        for (const detail of options.costDetails) {
          const id = `expense-${detail.id}`;
          node(id, detail.label, detail.amount, "expense", "detail", stage + 1);
          link(other.id, id, detail.amount, "expense");
        }
    }
    const net = income(
      "net",
      period.shareholderBridge?.base.scope === "consolidated"
        ? "Consolidated net profit"
        : m.noncontrollingInterestIncome !== undefined ||
            period.shareholderBridge?.base.scope === "parent"
          ? "Net profit to parent"
          : "Net profit",
      period.shareholderBridge?.base.scope === "consolidated"
        ? "Consolidated net loss"
        : m.noncontrollingInterestIncome !== undefined ||
            period.shareholderBridge?.base.scope === "parent"
          ? "Net loss to parent"
          : "Net loss",
      m.netIncome,
      ++stage
    );
    const gains: FlowNode[] = [],
      expenses: FlowNode[] = [];
    const add = (
      amount: number,
      id: string,
      label: string,
      group: FlowNode["group"],
      reportedAmount = amount
    ) => {
      const parts = stageEffects(amount, id, label, group, amount > 0 ? stage - 0.5 : stage);
      for (const item of [...parts.gains, ...parts.expenses]) item.signedAmount = reportedAmount;
      gains.push(...parts.gains);
      expenses.push(...parts.expenses);
    };
    add(
      -m.incomeTax,
      m.incomeTax < 0 ? "tax-benefit" : "tax",
      m.incomeTax < 0 ? "Income tax (benefit)" : "Tax expense",
      m.incomeTax < 0 ? "tax-benefit" : "tax",
      m.incomeTax
    );
    if (m.incomeTax === 0) node("tax", "Income tax", 0, "expense", "tax", stage, 0);
    add(
      m.equityMethodIncome ?? 0,
      "equity",
      (m.equityMethodIncome ?? 0) < 0
        ? "Equity-method loss (after tax)"
        : "Equity-method income (after tax)",
      "equity"
    );
    add(
      m.afterTaxSubsidiaryIncome ?? 0,
      "subsidiary",
      (m.afterTaxSubsidiaryIncome ?? 0) < 0
        ? "Unconsolidated subsidiary loss (after tax)"
        : "Unconsolidated subsidiary income (after tax)",
      "subsidiary"
    );
    if (period.afterTaxTransactionItems)
      add(
        m.afterTaxTransactionIncome!,
        "after-tax-transaction",
        afterTaxTransactionLabel(period.afterTaxTransactionItems),
        "after-tax-transaction"
      );
    add(
      m.discontinuedOperationsIncome ?? 0,
      "discontinued",
      (m.discontinuedOperationsIncome ?? 0) < 0
        ? "Discontinued operations loss (after tax)"
        : "Discontinued operations (after tax)",
      "discontinued"
    );
    add(
      -(m.noncontrollingInterestIncome ?? 0),
      "noncontrolling",
      (m.noncontrollingInterestIncome ?? 0) < 0
        ? "Loss of noncontrolling interests"
        : "Profit to noncontrolling interests",
      "noncontrolling",
      m.noncontrollingInterestIncome ?? 0
    );
    add(
      period.afterTaxReconciliation?.amount ?? 0,
      "after-tax-rounding",
      "Source rounding",
      "after-tax-adjustment"
    );
    if (!transition(net, gains, expenses))
      return { ok: false, reason: "The signed net-income stage does not reconcile." };
  }
  if (period.shareholderBridge) {
    const bridge = period.shareholderBridge;
    const common = income(
      "common-net",
      "Net income to common shareholders",
      "Net loss to common shareholders",
      bridge.common.amount,
      ++stage
    );
    const gains: FlowNode[] = [],
      expenses: FlowNode[] = [];
    for (const allocation of bridge.allocations) {
      const item = effect(
        allocation.id,
        allocation.label,
        -allocation.amount,
        "shareholder",
        allocation.amount < 0 ? stage - 0.5 : stage
      );
      item.signedAmount = allocation.amount;
      (allocation.amount < 0 ? gains : expenses).push(item);
    }
    if (!transition(common, gains, expenses))
      return { ok: false, reason: "The reported common-shareholder income does not reconcile." };
  }
  // Check every internal node, not merely the statement's ending balance.
  for (const item of nodes) {
    const incoming = links.filter((l) => l.target === item.id).reduce((sum, l) => sum + l.value, 0);
    const outgoing = links.filter((l) => l.source === item.id).reduce((sum, l) => sum + l.value, 0);
    if (
      (incoming && Math.abs(incoming - item.amount) > options.tolerance) ||
      (outgoing && Math.abs(outgoing - item.amount) > options.tolerance) ||
      (incoming && outgoing && Math.abs(incoming - outgoing) > options.tolerance)
    )
      return {
        ok: false,
        reason: `The signed accounting allocation at ${item.label} does not reconcile.`
      };
  }
  return { ok: true, graph: { nodes, links, signedAccounting: true } };
}

export function layoutSignedStatementFlow(graph: StatementFlow) {
  const scale = 300 / Math.max(1, ...graph.nodes.map((n) => n.amount));
  const nodeWidth = 16;
  const column = (stage: number) => 230 + stage * 235;
  const upper = new Map<number, FlowNode[]>(),
    lower = new Map<number, FlowNode[]>();
  for (const node of graph.nodes) {
    if (node.group === "main" || node.group === "segment" || node.group === "revenue-base")
      continue;
    const group = node.tone === "profit" ? upper : lower;
    const stage = node.stage!;
    group.set(stage, [...(group.get(stage) ?? []), node]);
  }
  const locations = new Map<string, { x: number; y: number }>();
  let mainY = 400;
  for (const [stage, items] of upper) {
    let y = 260;
    let previousBottom = 112;
    for (const item of items) {
      const above =
        wrapLabel(
          item.label,
          item.group === "nonoperating" || item.group === "direct-net-item" ? 17 : 23
        ).length *
          20 +
        49 +
        18;
      // Keep the complete wrapped label below the header and above its bar,
      // including the taller fallback-font ascent used by exported images.
      y = Math.max(y, previousBottom + 32 + above);
      locations.set(item.id, { x: column(stage), y });
      previousBottom = y + item.amount * scale;
      y += Math.max(item.amount * scale, 100) + 120;
    }
    mainY = Math.max(mainY, y + 140);
  }
  for (const [stage, items] of lower) {
    let y = mainY + 360;
    for (const item of items) {
      locations.set(item.id, { x: column(stage), y });
      y += Math.max(item.amount * scale, 100) + 150;
    }
  }
  // Expense details occupy the intervening column. Place net losses and negative
  // source rounding below those cost ribbons so they cannot imply an extra branch.
  const expenseNodes = graph.nodes.filter((n) => ["cost", "opex", "detail"].includes(n.group));
  const expenseBottom = Math.max(
    mainY + 360,
    ...expenseNodes.map((n) => locations.get(n.id)!.y + Math.max(n.amount * scale, 100))
  );
  const routedBottom = new Map<number, number>();
  for (const n of graph.nodes) {
    const afterDetails =
      n.group === "nonoperating" && graph.nodes.some((item) => item.group === "detail");
    if (
      n.tone === "expense" &&
      (afterDetails ||
        n.group === "operating-adjustment" ||
        n.group === "operating-item" ||
        n.group === "direct-net-item")
    ) {
      const current = locations.get(n.id)!;
      current.y = Math.max(current.y, routedBottom.get(n.stage!) ?? expenseBottom + 150);
      routedBottom.set(n.stage!, current.y + Math.max(n.amount * scale, 100) + 150);
    }
  }
  const business = graph.nodes.filter((n) => n.group === "segment");
  const businessHeight = business.reduce((sum, n) => sum + Math.max(n.amount * scale, 140) + 80, 0);
  let sourceY = Math.max(240, mainY - 100);
  if (business.length > 2) sourceY = Math.max(240, mainY + 150 - businessHeight / 2);
  const nodes: PositionedNode[] = graph.nodes.map((node) => {
    let y = mainY;
    if (node.group === "segment") {
      y = sourceY;
      sourceY += Math.max(node.amount * scale, 140) + 80;
    } else if (node.group !== "main" && node.group !== "revenue-base")
      y = locations.get(node.id)!.y;
    return { ...node, x: column(node.stage!), y, height: node.amount * scale };
  });
  const lookup = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<FlowLink, number>(),
    outgoing = new Map<FlowLink, number>();
  for (const node of nodes)
    for (const [own, adjacent, map] of [
      ["source", "target", outgoing],
      ["target", "source", incoming]
    ] as const) {
      let offset = 0;
      for (const link of graph.links
        .filter((l) => l[own] === node.id)
        .sort((a, b) => {
          const first = lookup.get(a[adjacent])!;
          const second = lookup.get(b[adjacent])!;
          return first.y + first.height / 2 - second.y - second.height / 2;
        })) {
        map.set(link, offset);
        offset += link.value * scale;
      }
    }
  const links: PositionedLink[] = graph.links.map((link) => {
    const source = lookup.get(link.source)!,
      target = lookup.get(link.target)!;
    const forward = target.x > source.x;
    const sameColumn = source.x === target.x;
    const sx = forward || sameColumn ? source.x + nodeWidth : source.x;
    const tx = forward ? target.x : target.x + nodeWidth;
    const sy = source.y + (outgoing.get(link) ?? 0),
      ty = target.y + (incoming.get(link) ?? 0),
      width = link.value * scale;
    const bend = sameColumn ? 105 : (tx - sx) * 0.5;
    const c1 = sx + bend,
      c2 = sameColumn ? tx + bend : tx - bend;
    const path = `M ${sx} ${sy} C ${c1} ${sy}, ${c2} ${ty}, ${tx} ${ty} L ${tx} ${ty + width} C ${c2} ${ty + width}, ${c1} ${sy + width}, ${sx} ${sy + width} Z`;
    const annotationPath = `M ${sx} ${sy + width / 2} C ${c1} ${sy + width / 2}, ${c2} ${ty + width / 2}, ${tx} ${ty + width / 2}`;
    return { ...link, width, path, annotationPath };
  });
  const width = Math.max(1480, ...nodes.map((n) => n.x + (n.group === "segment" ? 50 : 360)));
  const height = Math.max(960, ...nodes.map((n) => n.y + Math.max(n.height, 110) + 150)) + 110;
  return { nodes, links, scale, nodeWidth, width, height };
}
