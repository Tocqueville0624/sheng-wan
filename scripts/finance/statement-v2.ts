import { accountingTolerance } from "../../src/features/finance/chart-model";
import type { FinancialMetrics, StatementLine } from "../../src/features/finance/types";
import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import { attribute, factKey, halfUnit, precise, visibleText } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { flowPeriod } from "./v2-model";

/*
 * Generic issuers do not share one taxonomy. Oracle reports pretax income with an
 * issuer extension concept; Costco lists merchandise costs and SG&A without a
 * total; Visa totals operating expenses without a gross-profit line. This module
 * reads the filing's own primary income-statement table: rows in source order,
 * exact inline facts, visible labels, and exact accounting identities.
 *
 * Structural anchors are standard concepts that already carry the period's reported
 * values (revenue, operating income, income tax, net income). A row is accepted as
 * pretax profit only when it is the reported line immediately above income tax and
 * pretax − tax equals the next reported net-income line. Cost rows are used only when
 * they exactly partition revenue − operating income. Nothing is scaled, balanced,
 * guessed from a label, or estimated. Any conflict with an existing reported value,
 * ambiguity, or missing precision leaves the period unchanged.
 */

const OPERATING_INCOME = new Set([
  "us-gaap:OperatingIncomeLoss",
  "ifrs-full:ProfitLossFromOperatingActivities"
]);
const INCOME_TAX = new Set([
  "us-gaap:IncomeTaxExpenseBenefit",
  "ifrs-full:IncomeTaxExpenseContinuingOperations",
  "ifrs-full:IncomeTaxExpense"
]);
const PARENT_NET = new Set([
  "us-gaap:NetIncomeLoss",
  "ifrs-full:ProfitLossAttributableToOwnersOfParent"
]);
const CONSOLIDATED_NET = new Set(["us-gaap:ProfitLoss", "ifrs-full:ProfitLoss"]);
const GROSS_PROFIT = new Set(["us-gaap:GrossProfit", "ifrs-full:GrossProfit"]);
const COST_OF_REVENUE = new Set([
  "us-gaap:CostOfRevenue",
  "us-gaap:CostOfGoodsAndServicesSold",
  "us-gaap:CostOfSales",
  "ifrs-full:CostOfSales"
]);
const OPERATING_EXPENSES = new Set(["us-gaap:OperatingExpenses", "ifrs-full:OperatingExpense"]);
const REVENUE_TOTALS = [
  "us-gaap:RevenuesNetOfInterestExpense",
  "us-gaap:Revenues",
  "ifrs-full:Revenue",
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:SalesRevenueNet"
];
// After-tax statement lines with reviewed meaning and sign.
const CONTINUING = new Set([
  "us-gaap:IncomeLossFromContinuingOperations",
  "us-gaap:IncomeLossFromContinuingOperationsIncludingPortionAttributableToNoncontrollingInterest",
  "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeLossFromEquityMethodInvestments",
  "us-gaap:IncomeLossFromContinuingOperationsBeforeEquityMethodInvestmentsNoncontrollingInterest",
  "ifrs-full:ProfitLossFromContinuingOperations"
]);
const EQUITY_AFTER_TAX = new Set([
  "us-gaap:IncomeLossFromEquityMethodInvestments",
  "us-gaap:IncomeLossFromEquityMethodInvestmentsNetOfTax"
]);
const DISCONTINUED =
  /^us-gaap:(?:IncomeLossFromDiscontinuedOperationsNetOfTax|DiscontinuedOperationIncomeLossFromDiscontinuedOperationNetOfTax)\w*$/;
const MINORITY =
  /^(?:us-gaap:(?:NetIncomeLossAttributableTo(?:Nonredeemable|Redeemable)?NoncontrollingInterest|NoncontrollingInterestInNetIncomeLoss\w*|IncomeLossFromContinuingOperationsAttributableToNoncontrollingEntity|MinorityInterestInNetIncomeLossOfConsolidatedEntities)|ifrs-full:ProfitLossAttributableToNoncontrollingInterests)$/;
const QNAME = /^[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*$/;

type Row = { label: string; facts: (XbrlFact | undefined)[] };
type Line = { label: string; fact: XbrlFact };

function rowLabel(row: string) {
  for (const [, cell] of row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
    if (/<ix:nonFraction\b/i.test(cell)) break;
    // Trailing footnote references such as "(1)" or "(a)" are not part of the line name.
    const label = visibleText(cell).replace(/(?:\s*(?:\((?:\d{1,2}|[a-z])\)|\*+))+$/i, "");
    if (label) return label.length <= 180 ? label : "";
  }
  return "";
}

/** Period-specific rows of one table; a row is usable only with exactly one precise fact. */
export function tableRows(
  table: string,
  refs: Map<string, XbrlFact | undefined>,
  consolidated: Map<string, XbrlFact | undefined> = new Map()
): Row[] | undefined {
  if (table.length > 512000 || /<table\b/i.test(table.slice(6))) return;
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  if (rows.length > 500) return;
  const result: Row[] = [];
  for (const [row] of rows) {
    const seen = new Map<string, XbrlFact | undefined>();
    for (const [opening] of row.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
      const key = `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`;
      if (!refs.has(key)) continue;
      let fact = refs.get(key);
      // Some issuers tag the statement's net-income cell with the equity-statement
      // retained-earnings member. The same reported non-dimensional amount is used.
      const plain = fact && consolidated.get(fact.tag);
      if (
        fact &&
        plain &&
        Object.keys(fact.context.dimensions).length &&
        (PARENT_NET.has(fact.tag) || CONSOLIDATED_NET.has(fact.tag)) &&
        plain.value === fact.value
      )
        fact = plain;
      seen.set(fact ? factKey(fact) : key, fact);
    }
    if (seen.size) result.push({ label: rowLabel(row), facts: [...seen.values()] });
  }
  return result;
}

const line = (row: Row | undefined): Line | undefined => {
  const fact = row?.facts.length === 1 ? row.facts[0] : undefined;
  if (!fact || Object.keys(fact.context.dimensions).length || !QNAME.test(fact.tag)) return;
  return { label: row!.label, fact };
};

export type StatementReading = {
  metrics: Partial<FinancialMetrics>;
  sources: PeriodV2["metricSources"];
  operatingReconciliation?: PeriodV2["operatingReconciliation"];
  operatingCostDetails?: StatementLine[];
  operatingExpenseDetails?: StatementLine[];
  operatingExpensesBasis?: PeriodV2["operatingExpensesBasis"];
};

/** Interpret one table for one period, or return undefined when any rule is not met. */
export function readStatementRows(
  rows: Row[],
  period: PeriodV2,
  filing: Pick<SecFiling, "accession" | "filedAt" | "sourceUrl">
): StatementReading | undefined {
  const m = period.metrics;
  const revenueSource = period.metricSources.revenue;
  if (
    m.revenue !== undefined &&
    (!(m.revenue > 0) ||
      revenueSource?.method !== "reported" ||
      revenueSource.accession !== filing.accession)
  )
    return;
  const lines = rows.map(line);
  const find = (from: number, to: number, test: (item: Line) => boolean) => {
    for (let i = Math.max(0, from); i < Math.min(to, lines.length); i++)
      if (lines[i] && test(lines[i]!)) return i;
    return -1;
  };
  let anchor =
    m.revenue !== undefined
      ? find(
          0,
          lines.length,
          (l) => l.fact.tag === revenueSource!.tag && l.fact.value === m.revenue
        )
      : -1;
  if (m.revenue === undefined) {
    // A missing Company Facts line can be recovered from an explicit standard
    // revenue total in this primary statement. The entire subsequent accounting
    // chain still has to reconcile; a label alone never defines revenue.
    for (const tag of REVENUE_TOTALS) {
      const matches = lines.flatMap((l, i) =>
        l &&
        l.fact.tag === tag &&
        l.fact.value > 0 &&
        /^(?:total\s+)?(?:net\s+)?(?:revenues?|sales)$/i.test(l.label)
          ? [i]
          : []
      );
      if (matches.length) {
        if (matches.length === 1) anchor = matches[0];
        break;
      }
    }
  }
  if (
    anchor < 0 &&
    m.revenue !== undefined &&
    revenueSource?.sourceUrl === filing.sourceUrl &&
    revenueSource.filedAt === filing.filedAt &&
    REVENUE_TOTALS.includes(revenueSource.tag) &&
    !period.coverage.segments
  ) {
    // Some filings use a different standard revenue concept in the primary
    // statement than Company Facts. Require one exact same-amount source row;
    // its entire accounting chain must still pass before its provenance changes.
    const matches = lines.flatMap((l, i) =>
      l &&
      REVENUE_TOTALS.includes(l.fact.tag) &&
      l.fact.value === m.revenue &&
      /^(?:total\s+)?(?:net\s+)?(?:revenues?|sales)$/i.test(l.label)
        ? [i]
        : []
    );
    if (matches.length === 1) anchor = matches[0];
  }
  if (anchor < 0) return;
  const tolerance = accountingTolerance(lines[anchor]!.fact.value);
  const same = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  // Company Facts can select a revenue sub-line (Walmart's net sales before membership
  // income). When the following nonnegative rows add up exactly to a reported
  // us-gaap:Revenues total before any cost row, that statement total is the top line.
  // Periods whose business breakdown cites the original concept keep it.
  let iR = anchor;
  if (!period.coverage.segments || period.businessBreakdownSource) {
    let sum = lines[anchor]!.fact.value;
    for (let i = anchor + 1; i < Math.min(lines.length, anchor + 6); i++) {
      const item = lines[i];
      if (!item || item.fact.value < 0) break;
      if (item.fact.tag === "us-gaap:Revenues") {
        if (i > anchor + 1 && same(item.fact.value, sum)) iR = i;
        break;
      }
      sum += item.fact.value;
    }
  }
  const iT = find(iR + 1, lines.length, (l) => INCOME_TAX.has(l.fact.tag));
  if (iT < 0) return;
  const revenue = lines[iR]!,
    revenueValue = revenue.fact.value,
    tax = lines[iT]!,
    pretax = lines[iT - 1];
  // The pretax line is the reported row directly above tax.
  if (!pretax || iT - 1 <= iR) return;

  // After tax, walk reported rows in order: subtotals must equal the running
  // amount; after-tax equity income, discontinued operations and noncontrolling
  // interests change it by their reported signed values; the parent net-income
  // row must equal the result. Any other line withholds the reading.
  let running = pretax.fact.value - tax.fact.value;
  let parent: Line | undefined;
  let consolidated: Line | undefined;
  const equity: Line[] = [];
  const subsidiaries: Line[] = [];
  const discontinued: Line[] = [];
  const minority: Line[] = [];
  for (let i = iT + 1; i < lines.length && !parent; i++) {
    const item = lines[i];
    const tag = item?.fact.tag ?? "";
    if (item && PARENT_NET.has(tag)) {
      if (!same(item.fact.value, running)) return;
      parent = item;
    } else if (item && EQUITY_AFTER_TAX.has(tag) && !minority.length) {
      equity.push(item);
      running += item.fact.value;
    } else if (item && tag === "us-gaap:IncomeLossFromSubsidiariesNetOfTax" && !minority.length) {
      subsidiaries.push(item);
      running += item.fact.value;
    } else if (
      item &&
      DISCONTINUED.test(tag) &&
      (!minority.length || tag.endsWith("AttributableToReportingEntity"))
    ) {
      discontinued.push(item);
      running += item.fact.value;
    } else if (item && MINORITY.test(tag)) {
      minority.push(item);
      running -= item.fact.value;
    } else if (
      item &&
      same(item.fact.value, running) &&
      (CONTINUING.has(tag) ||
        (!minority.length && (CONSOLIDATED_NET.has(tag) || !/^(us-gaap|ifrs-full):/.test(tag))))
    ) {
      // A reported subtotal (issuer extensions only when their amount is exact).
      if (CONSOLIDATED_NET.has(tag)) consolidated = item;
    } else if (consolidated && !minority.length) break;
    else return;
  }
  parent ??= consolidated && !minority.length ? consolidated : undefined;
  if (!parent) return;
  const signed = (items: Line[]) => items.reduce((sum, item) => sum + item.fact.value, 0);
  const iO = find(iR + 1, iT - 1, (l) => OPERATING_INCOME.has(l.fact.tag));
  const operating = iO >= 0 ? lines[iO]! : undefined;

  const metrics: Partial<FinancialMetrics> = {};
  const sources: PeriodV2["metricSources"] = {};
  const reported = (item: Line): MetricSource => ({
    label: item.label || item.fact.tag,
    tag: item.fact.tag,
    accession: filing.accession,
    filedAt: filing.filedAt,
    sourceUrl: filing.sourceUrl,
    method: "reported",
    ...(Number.isInteger(item.fact.decimals) ? { decimals: item.fact.decimals } : {})
  });
  // Existing values keep their provenance; a different amount is a conflict.
  const assign = (key: keyof FinancialMetrics, item: Line) => {
    const existing = m[key];
    if (existing !== undefined) return same(existing, item.fact.value);
    metrics[key] = item.fact.value;
    sources[key] = reported(item);
    return true;
  };
  const difference = (key: keyof FinancialMetrics, from: Line, to: Line, label: string) => {
    const value = from.fact.value - to.fact.value;
    if (value < 0) return false;
    if (m[key] !== undefined) return same(m[key]!, value);
    metrics[key] = value;
    sources[key] = {
      label,
      tag: `${from.fact.tag} - ${to.fact.tag}`,
      accession: filing.accession,
      filedAt: filing.filedAt,
      sourceUrl: filing.sourceUrl,
      method: "calculated",
      inputs: [from, to].map((item) => `${item.label} (${item.fact.tag}): ${filing.sourceUrl}`)
    };
    return true;
  };
  // Several lines of one kind are reported separately; their exact sum is used.
  const assignAll = (key: keyof FinancialMetrics, items: Line[], label: string) => {
    const value = signed(items);
    // A reported zero (for example "—" discontinued operations) adds no flow.
    if (!items.length || (m[key] === undefined && same(value, 0)))
      return m[key] === undefined || same(m[key]!, value);
    if (items.length === 1) return assign(key, items[0]);
    if (m[key] !== undefined) return same(m[key]!, value);
    metrics[key] = value;
    sources[key] = {
      label,
      tag: items.map((item) => item.fact.tag).join(" + "),
      accession: filing.accession,
      filedAt: filing.filedAt,
      sourceUrl: filing.sourceUrl,
      method: "calculated",
      inputs: items.map((item) => `${item.label} (${item.fact.tag}): ${filing.sourceUrl}`)
    };
    return true;
  };
  if (iR !== anchor || m.revenue === undefined || revenue.fact.tag !== revenueSource?.tag) {
    metrics.revenue = revenueValue;
    sources.revenue = reported(revenue);
  }
  if (!assign("incomeTax", tax) || !assign("pretaxIncome", pretax)) return;
  if (!assign("netIncome", parent)) return;
  if (
    !assignAll("noncontrollingInterestIncome", minority, "Noncontrolling interests") ||
    !assignAll("equityMethodIncome", equity, "After-tax equity-method income") ||
    !assignAll(
      "afterTaxSubsidiaryIncome",
      subsidiaries,
      "After-tax income from unconsolidated subsidiaries"
    ) ||
    !assignAll("discontinuedOperationsIncome", discontinued, "Discontinued operations")
  )
    return;
  if (operating && !assign("operatingIncome", operating)) return;
  if (!operating && m.operatingIncome !== undefined) return { metrics, sources };

  const iEnd = operating ? iO : iT - 1;
  const block = lines.slice(iR + 1, iEnd);
  // Every row in the range must be one precise non-dimensional fact; zero rows are
  // part of the exact sum but are not drawn.
  const detail = (items: (Line | undefined)[], total: number): StatementLine[] | undefined => {
    if (
      items.some((item) => !item || item.fact.value < 0 || !item.label) ||
      !same(
        items.reduce((sum, item) => sum + item!.fact.value, 0),
        total
      )
    )
      return;
    const drawn = items.filter((item) => item!.fact.value > 0);
    if (drawn.length < 2) return;
    const ids = new Set<string>();
    return drawn.map((item, index) => {
      let id = `line-${item!.fact.tag.split(":").at(-1)!}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      if (ids.has(id)) id = `${id}-${index}`;
      ids.add(id);
      return {
        id,
        label: item!.label,
        amount: item!.fact.value,
        tag: item!.fact.tag,
        ...(Number.isInteger(item!.fact.decimals) ? { decimals: item!.fact.decimals } : {})
      };
    });
  };
  const result: StatementReading = { metrics, sources };
  const iG = block.findIndex((item) => item && GROSS_PROFIT.has(item.fact.tag));
  if (!operating) {
    // No operating-profit line: revenue (or reported gross profit) less one net
    // amount of expenses and other items equals reported pretax profit.
    let base = revenue;
    let rest = block;
    if (iG >= 0) {
      const gross = block[iG]!;
      const cost = block[iG - 1];
      if (!assign("grossProfit", gross)) return;
      if (m.costOfRevenue !== undefined) {
        if (!same(m.costOfRevenue, revenue.fact.value - gross.fact.value)) return;
      } else if (cost && same(cost.fact.value, revenue.fact.value - gross.fact.value)) {
        if (!assign("costOfRevenue", cost)) return;
      } else return;
      base = gross;
      rest = block.slice(iG + 1);
    } else if (m.grossProfit !== undefined) return;
    const amount = base.fact.value - pretax.fact.value;
    if (!(amount >= 0)) return;
    const total = rest.at(-1);
    const hasTotal = !!total && same(total.fact.value, amount);
    if (m.expensesAndOtherItems !== undefined && !same(m.expensesAndOtherItems, amount)) return;
    if (hasTotal) assign("expensesAndOtherItems", total);
    else if (m.expensesAndOtherItems === undefined) {
      metrics.expensesAndOtherItems = amount;
      sources.expensesAndOtherItems = {
        label: iG >= 0 ? "Gross profit less pretax profit" : "Revenue less pretax profit",
        tag: `${base.fact.tag} - ${pretax.fact.tag}`,
        accession: filing.accession,
        filedAt: filing.filedAt,
        sourceUrl: filing.sourceUrl,
        method: "calculated",
        inputs: [base, pretax].map(
          (item) => `${item.label} (${item.fact.tag}): ${filing.sourceUrl}`
        )
      };
    }
    const details = detail(hasTotal ? rest.slice(0, -1) : rest, amount);
    if (details) result.operatingCostDetails = details;
    return result;
  }
  const grossStage =
    m.costOfRevenue !== undefined &&
    m.grossProfit !== undefined &&
    m.operatingExpenses !== undefined;
  if (iG >= 0 || grossStage) {
    // A current-filing candidate can contain only revenue. Read the reported
    // consolidated gross subtotal before calculating its two intervening totals;
    // never manufacture gross profit from an unreviewed cost concept.
    if (iG < 0) return result;
    const gross = block[iG]!;
    if (!assign("grossProfit", gross)) return;
    if (m.grossProfit !== undefined && period.metricSources.grossProfit?.method === "calculated") {
      // The same amount now has direct primary-statement evidence. Preserve the
      // reported fact rather than the earlier generic revenue-minus-cost inference.
      metrics.grossProfit = gross.fact.value;
      sources.grossProfit = reported(gross);
    }
    const costs = block.slice(0, iG).filter((item) => item && COST_OF_REVENUE.has(item.fact.tag));
    const cost = costs.length === 1 ? costs[0] : undefined;
    const costAmount = revenueValue - gross.fact.value;
    if (cost && !same(cost.fact.value, costAmount)) return;
    if (
      cost
        ? !assign("costOfRevenue", cost)
        : !difference("costOfRevenue", revenue, gross, "Revenue less reported gross profit")
    )
      return;
    const expenses = gross.fact.value - operating.fact.value;
    const after = block.slice(iG + 1);
    const total = after.at(-1);
    const hasTotal =
      !!total && OPERATING_EXPENSES.has(total.fact.tag) && same(total.fact.value, expenses);
    if (total && OPERATING_EXPENSES.has(total.fact.tag) && !hasTotal) return;
    if (
      hasTotal
        ? !assign("operatingExpenses", total)
        : !difference(
            "operatingExpenses",
            gross,
            operating,
            "Reported gross profit less operating income (net)"
          )
    )
      return;
    if (hasTotal && period.metricSources.operatingExpenses?.method === "calculated") {
      metrics.operatingExpenses = total.fact.value;
      sources.operatingExpenses = reported(total);
    }
    const items = hasTotal ? after.slice(0, -1) : after;
    const details = detail(items, expenses);
    if (details) result.operatingExpenseDetails = details;
    else if (
      !hasTotal &&
      expenses > 0 &&
      (sources.operatingExpenses ?? period.metricSources.operatingExpenses)?.method === "calculated"
    )
      result.operatingExpensesBasis = "expenses-and-other-items-net";
    return result;
  }
  // Direct route: revenue = total operating costs + operating income.
  const target = revenueValue - operating.fact.value;
  // Only the final row before operating income can be the reported total.
  let totalIndex = -1;
  const last = block.at(-1);
  if (last && rows[iO - 1]?.facts.length === 1) {
    const difference = target - last.fact.value;
    const bound = [revenue, last, operating].reduce(
      (sum, item) => sum + (halfUnit(item.fact) ?? Infinity),
      0
    );
    if (
      same(last.fact.value, target) ||
      (Math.abs(difference) <= bound && Math.abs(difference) <= revenueValue * 0.001)
    )
      totalIndex = block.length - 1;
  }
  if (totalIndex >= 0) {
    const total = block[totalIndex]!;
    if (!assign("totalOperatingCosts", total)) return;
    const difference = operating.fact.value - (revenueValue - total.fact.value);
    if (!same(difference, 0)) {
      result.operatingReconciliation = {
        label: "Source rounding",
        amount: difference,
        sourceUrl: filing.sourceUrl
      };
      for (const [key, item] of [
        ["revenue", revenue],
        ["totalOperatingCosts", total],
        ["operatingIncome", operating]
      ] as const)
        if (
          period.metricSources[key]?.decimals === undefined &&
          Number.isInteger(item.fact.decimals)
        )
          sources[key] = {
            ...(sources[key] ?? period.metricSources[key]!),
            decimals: item.fact.decimals
          };
    }
    const details = detail(block.slice(0, totalIndex), total.fact.value);
    if (details) result.operatingCostDetails = details;
    return result;
  }
  // No reported total: the listed cost rows must exactly partition the costs.
  const details = detail(block, target);
  if (!details) return;
  if (m.totalOperatingCosts !== undefined && !same(m.totalOperatingCosts, target)) return;
  if (m.totalOperatingCosts === undefined) {
    metrics.totalOperatingCosts = details.reduce((sum, item) => sum + item.amount, 0);
    sources.totalOperatingCosts = {
      label: "Sum of reported operating cost lines",
      tag: details.map((item) => item.tag).join(" + "),
      accession: filing.accession,
      filedAt: filing.filedAt,
      sourceUrl: filing.sourceUrl,
      method: "calculated",
      inputs: details.map((item) => `${item.label} (${item.tag}): ${filing.sourceUrl}`)
    };
  }
  result.operatingCostDetails = details;
  return result;
}

/** Apply a statement reading only when the resulting period passes the flow contract. */
export function applyStatementReading(period: PeriodV2, reading: StatementReading) {
  const next: PeriodV2 = {
    ...period,
    metrics: { ...period.metrics, ...reading.metrics },
    metricSources: { ...period.metricSources, ...reading.sources },
    coverage: { ...period.coverage }
  };
  const revenueAmountChanged =
    reading.metrics.revenue !== undefined && reading.metrics.revenue !== period.metrics.revenue;
  const revenueConceptChanged =
    reading.sources.revenue !== undefined &&
    reading.sources.revenue.tag !== period.metricSources.revenue?.tag;
  if (revenueAmountChanged || revenueConceptChanged) {
    // A source-proven consolidated revenue total supersedes a generic partition
    // of a sub-line (for example net sales). Re-read all business branches against
    // the new top line; never carry the old split or its derived margin across.
    if (period.businessBreakdownSource) {
      delete next.segments;
      delete next.segmentBasis;
      delete next.segmentSourceUrl;
      delete next.businessBreakdownSource;
      delete next.revenueAdjustments;
      next.coverage.segments = false;
    }
    for (const [metric, tag] of revenueAmountChanged
      ? ([
          ["grossProfit", "revenue - costOfRevenue"],
          ["operatingExpenses", "grossProfit - operatingIncome"]
        ] as const)
      : []) {
      if (period.metricSources[metric]?.tag === tag && reading.metrics[metric] === undefined) {
        delete next.metrics[metric];
        delete next.metricSources[metric];
      }
    }
  }
  if (reading.operatingReconciliation)
    next.operatingReconciliation = reading.operatingReconciliation;
  if (reading.operatingCostDetails) next.operatingCostDetails = reading.operatingCostDetails;
  if (reading.operatingExpenseDetails && !period.operatingExpenseDetails)
    next.operatingExpenseDetails = reading.operatingExpenseDetails;
  if (reading.operatingExpensesBasis) next.operatingExpensesBasis = reading.operatingExpensesBasis;
  else if (
    reading.operatingExpenseDetails ||
    reading.sources.operatingExpenses?.method === "reported"
  )
    delete next.operatingExpensesBasis;
  next.derived = Object.values(next.metricSources).some(
    (source) => source?.method === "calculated"
  );
  const statement = flowPeriod(next);
  if (!statement) return;
  next.coverage.sankey = true;
  return next;
}

/** Complete consolidated flows from the filing's primary income-statement rows. */
export function enrichStatementPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsedInput?: ParsedFiling
): PeriodV2[] {
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Statement filing URL does not match the SEC issuer and accession.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Statement source CIK does not match the catalog.");
  const periods = existing.filter(
    (p) =>
      p.accession === filing.accession &&
      p.filedAt === filing.filedAt &&
      p.sourceUrl === filing.sourceUrl &&
      p.displayCurrency === "USD" &&
      p.reportingCurrency === "USD" &&
      !p.grossProfitAdjustments?.length &&
      !(p.coverage.sankey && (p.operatingCostDetails || p.operatingExpenseDetails))
  );
  if (!periods.length) return [];
  // Only tables that tag an income-tax line can be a primary income statement.
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map(([table]) => table)
    .filter((table) => /<ix:nonFraction\b[^>]*IncomeTax/i.test(table));
  if (tables.length > 2000) throw new Error("Statement table count exceeds safe limits.");
  const output: PeriodV2[] = [];
  for (const period of periods) {
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        !f.context.typed &&
        f.currency === period.displayCurrency &&
        Number.isFinite(f.value)
    );
    const groups = new Map<string, XbrlFact[]>();
    for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
    const consolidated = new Map(
      [...best.values()]
        .filter((f): f is XbrlFact => !!f && !Object.keys(f.context.dimensions).length)
        .map((f) => [f.tag, f])
    );
    for (const table of tables) {
      const rows = tableRows(table, refs, consolidated);
      if (!rows || rows.length < 5) continue;
      const reading = readStatementRows(rows, period, filing);
      if (!reading) continue;
      const next = applyStatementReading(period, reading);
      if (!next) continue;
      const changed =
        !period.coverage.sankey ||
        Object.keys(reading.metrics).length > 0 ||
        !!next.operatingCostDetails !== !!period.operatingCostDetails ||
        !!next.operatingExpenseDetails !== !!period.operatingExpenseDetails ||
        next.operatingExpensesBasis !== period.operatingExpensesBasis;
      if (changed) output.push(next);
      break;
    }
  }
  return output;
}
