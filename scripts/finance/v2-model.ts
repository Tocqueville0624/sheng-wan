import { buildStatementFlow, segmentProblem } from "../../src/features/finance/chart-model";
import { shareholderBridgeProblem } from "../../src/features/finance/shareholder-bridge";
import {
  grossOperatingItemsProblem,
  grossOperatingRoundingBound
} from "../../src/features/finance/gross-operating-items";
import type {
  CompanyDataset,
  FinancialMetrics,
  FinancialPeriod,
  FlowStatementPeriod,
  StatementChartPeriod,
  DirectNetStatementPeriod,
  OperatingNetStatementPeriod,
  BusinessPeriod
} from "../../src/features/finance/types";
import type { CompanyV2, PeriodV2, MetricSource } from "../../src/features/finance/v2-types";
import { validatePeriod, validateSegmentGrossProfits, roundingTolerance } from "./validate";
import {
  businessRules,
  isBusinessCategory,
  isZeroRevenueReconciliation,
  sameDimensions,
  validBusinessQualifiers,
  type BusinessRule
} from "../../src/features/finance/business-rules";
import { productPortfolioProblem } from "../../src/features/finance/product-portfolios";

/** Standard cost tags can describe only one activity (for example franchise rent).
 * A generic revenue-minus-cost residual is not a reported consolidated gross profit.
 * Require an independent reported operating-expense subtotal to corroborate it.
 * This also repairs previously stored basic imports without another SEC crawl.
 */
export function normalizeBasicPeriod(period: PeriodV2): PeriodV2 {
  const axis = period.businessBreakdownSource?.axis;
  if (
    axis &&
    period.segments?.some(
      (s) => !isBusinessCategory(axis, s.revenueSource?.dimensions[axis] ?? "", s.label)
    )
  ) {
    const next: PeriodV2 = {
      ...period,
      coverage: { ...period.coverage, segments: false, sankey: false }
    };
    delete next.segments;
    delete next.segmentBasis;
    delete next.segmentSourceUrl;
    delete next.businessBreakdownSource;
    delete next.revenueAdjustments;
    const normalized = normalizeBasicPeriod(next);
    normalized.coverage.sankey = !!flowPeriod(normalized);
    return normalized;
  }
  if (
    period.coverage.segments ||
    period.metricSources.grossProfit?.tag !== "revenue - costOfRevenue"
  )
    return period;
  const m = period.metrics;
  if (
    period.metricSources.operatingExpenses?.method === "reported" &&
    m.operatingExpenses !== undefined &&
    m.operatingIncome !== undefined &&
    m.grossProfit !== undefined &&
    Math.abs(m.grossProfit - m.operatingExpenses - m.operatingIncome) <=
      roundingTolerance(m.revenue ?? 1)
  )
    return period;
  const next: PeriodV2 = {
    ...period,
    metrics: { ...period.metrics },
    metricSources: { ...period.metricSources },
    coverage: { ...period.coverage, sankey: false }
  };
  delete next.metrics.grossProfit;
  delete next.metricSources.grossProfit;
  if (next.metricSources.operatingExpenses?.tag === "grossProfit - operatingIncome") {
    delete next.metrics.operatingExpenses;
    delete next.metricSources.operatingExpenses;
  }
  next.derived = Object.values(next.metricSources).some((source) => source.method === "calculated");
  return next;
}

export function normalizeBasicCompany(company: CompanyV2): CompanyV2 {
  const annual = company.annual.map(normalizeBasicPeriod);
  const quarterly = company.quarterly.map(normalizeBasicPeriod);
  if (
    annual.every((p, i) => p === company.annual[i]) &&
    quarterly.every((p, i) => p === company.quarterly[i])
  )
    return company;
  return {
    ...company,
    annual,
    quarterly,
    version: `${company.version}-scope2`,
    warnings: [
      ...new Set([
        ...company.warnings,
        "Unreviewed cost-derived gross profit and revenue-recognition timing partitions are withheld. Reported revenue and income remain available."
      ])
    ]
  };
}

export function statementPeriod(period: PeriodV2): FinancialPeriod | undefined {
  if (period.displayCurrency !== "USD") return;
  const required = [
    "revenue",
    "costOfRevenue",
    "grossProfit",
    "operatingExpenses",
    "operatingIncome",
    "pretaxIncome",
    "incomeTax",
    "netIncome"
  ] as const;
  if (required.some((key) => !Number.isFinite(period.metrics[key]))) return;
  const statement = period as FinancialPeriod;
  try {
    validatePeriod(statement);
    return statement;
  } catch {
    return;
  }
}

function externalCustomerColumnsValid(period: PeriodV2, rule: BusinessRule): boolean {
  const schema = rule.externalCustomerColumns;
  const proof = period.businessBreakdownSource!;
  const columns = proof.externalCustomerColumns;
  if (!schema) return !columns;
  const revenue = period.metricSources.revenue;
  if (
    !columns ||
    proof.layout !== "columns" ||
    proof.totalTableIndex === proof.tableIndex ||
    !Number.isInteger(proof.headerRowIndex) ||
    !Number.isInteger(proof.rowIndex) ||
    proof.headerRowIndex! < 0 ||
    proof.rowIndex! > 500 ||
    proof.headerRowIndex! >= proof.rowIndex! ||
    proof.omittedSubtotals.length ||
    proof.omittedZeroColumns?.length ||
    proof.qualifiers ||
    revenue?.method !== "reported" ||
    revenue.sourceUrl !== period.sourceUrl ||
    revenue.accession !== period.accession ||
    revenue.filedAt !== period.filedAt
  )
    return false;
  const labels = [
    ...rule.branches.map((b) => b.columnLabel ?? b.label),
    ...schema.totalLabels,
    ...schema.blankLabels
  ];
  if (
    columns.headers.length !== labels.length ||
    labels.some((label) => columns.headers.filter((h) => h.label === label).length !== 1) ||
    columns.totals.length !== schema.totalLabels.length ||
    columns.blanks.length !== schema.blankLabels.length
  )
    return false;
  const ordered = [...columns.headers].sort((a, b) => a.columnIndex - b.columnIndex);
  if (
    ordered.some(
      (h, i) =>
        !Number.isInteger(h.columnIndex) ||
        h.columnIndex < 0 ||
        !Number.isInteger(h.span) ||
        h.span < 1 ||
        h.span > 200 ||
        h.columnIndex + h.span > 1000 ||
        (i > 0 && ordered[i - 1].columnIndex + ordered[i - 1].span > h.columnIndex)
    )
  )
    return false;
  const within = (label: string, column: number | undefined) => {
    const h = columns.headers.find((h) => h.label === label);
    return (
      !!h &&
      Number.isInteger(column) &&
      column! >= h.columnIndex &&
      column! < h.columnIndex + h.span
    );
  };
  const seen = new Set<number>();
  for (const branch of rule.branches) {
    const source = period.segments?.find((s) => s.label === branch.label)?.revenueSource;
    if (
      !source ||
      source.rowIndex !== proof.rowIndex ||
      !within(branch.columnLabel ?? branch.label, source.columnIndex) ||
      seen.has(source.columnIndex!)
    )
      return false;
    seen.add(source.columnIndex!);
  }
  for (const label of schema.totalLabels) {
    const total = columns.totals.filter((t) => t.label === label);
    if (total.length !== 1) return false;
    const t = total[0];
    if (
      t.tag !== rule.totalTag ||
      t.value !== proof.revenue ||
      !t.dimensions ||
      Object.keys(t.dimensions).length ||
      !Number.isInteger(t.decimals) ||
      t.decimals < -18 ||
      t.decimals > 18 ||
      !within(label, t.columnIndex) ||
      seen.has(t.columnIndex)
    )
      return false;
    seen.add(t.columnIndex);
  }
  const final = columns.totals.at(-1)!;
  if (final.columnIndex !== proof.columnIndex || final.decimals !== proof.revenueDecimals)
    return false;
  for (const label of schema.blankLabels) {
    const blank = columns.blanks.filter((b) => b.label === label);
    if (
      blank.length !== 1 ||
      blank[0].columnIndex !== columns.headers.find((h) => h.label === label)?.columnIndex
    )
      return false;
  }
  return true;
}

/** Financial flows need a reconciled statement, but not necessarily a gross-profit subtotal. */
export function businessPeriod(period: PeriodV2): BusinessPeriod | undefined {
  if (period.displayCurrency !== "USD" || !Number.isFinite(period.metrics.revenue)) return;
  const business = period as BusinessPeriod;
  if (
    segmentProblem(business) ||
    !period.segmentBasis ||
    period.segmentSourceUrl !== period.sourceUrl
  )
    return;
  const proof = period.businessBreakdownSource;
  if (!proof) {
    // Existing reviewed adapters retain their contract and reported adjustments.
    if (period.revenueAdjustments?.some((item) => item.id === "source-rounding")) return;
    return business;
  }
  if (proof.method === "reported-product-portfolios")
    return productPortfolioProblem(period) ? undefined : business;
  if (proof.productPortfolios || period.segments?.some((s) => s.revenueSource?.calculation)) return;
  const qname = /^[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*$/;
  const rule =
    proof.method === "reviewed-segment-table"
      ? businessRules.find((r) => r.id === proof.ruleId)
      : undefined;
  if (
    proof.method === "reviewed-segment-table" &&
    (!rule ||
      !period.sourceUrl.startsWith(
        `https://www.sec.gov/Archives/edgar/data/${Number(rule.cik)}/`
      ) ||
      proof.revenueTag !== rule.totalTag ||
      proof.totalLabel !== rule.totalLabel ||
      proof.axis ||
      !!rule.separateTotal !== (proof.totalTableIndex !== undefined) ||
      (proof.totalTableIndex !== undefined &&
        (!Number.isInteger(proof.totalTableIndex) || proof.totalTableIndex < 0)) ||
      period.segments!.length !== rule.branches.length ||
      !externalCustomerColumnsValid(period, rule))
  )
    return;
  const halfUnit = (decimals: number) =>
    Number.isInteger(decimals) && decimals >= -18 && decimals <= 18 ? 0.5 * 10 ** -decimals : NaN;
  if (
    !["statement-revenue-rows", "statement-revenue-matrix", "reviewed-segment-table"].includes(
      proof.method
    ) ||
    !Number.isInteger(proof.tableIndex) ||
    proof.tableIndex < 0 ||
    proof.sourceUrl !== period.sourceUrl ||
    proof.accession !== period.accession ||
    proof.revenue !== period.metrics.revenue ||
    proof.revenueTag !== period.metricSources.revenue?.tag ||
    (proof.externalCustomerColumns && !rule?.externalCustomerColumns) ||
    !proof.totalLabel ||
    !Number.isFinite(halfUnit(proof.revenueDecimals)) ||
    (proof.axis &&
      ![
        "srt:ProductOrServiceAxis",
        "us-gaap:ProductOrServiceAxis",
        "us-gaap:StatementBusinessSegmentsAxis"
      ].includes(proof.axis))
  )
    return;
  const matrix = proof.method === "statement-revenue-matrix";
  if (
    matrix &&
    (!proof.axis ||
      !proof.qualifiers ||
      !validBusinessQualifiers(proof.qualifiers) ||
      !Number.isInteger(proof.columnIndex) ||
      proof.columnIndex! < 0 ||
      proof.columnIndex! > 1000 ||
      (proof.layout !== undefined && proof.layout !== "columns") ||
      (proof.layout !== "columns" &&
        (proof.totalTableIndex !== undefined ||
          proof.totalDimensions ||
          proof.omittedZeroColumns?.length)) ||
      proof.ruleId ||
      period.segments!.length < 2 ||
      period.segments!.length > 20)
  )
    return;
  const columns = matrix && proof.layout === "columns";
  if (
    columns &&
    (!Number.isInteger(proof.headerRowIndex) ||
      !Number.isInteger(proof.rowIndex) ||
      proof.headerRowIndex! < 0 ||
      proof.rowIndex! > 500 ||
      proof.headerRowIndex! >= proof.rowIndex!)
  )
    return;
  if (columns) {
    const dimensions = proof.totalDimensions ?? {};
    const parent = dimensions[proof.axis!];
    if (!Object.keys(dimensions).length || sameDimensions(dimensions, proof.qualifiers!)) {
      if (proof.totalTableIndex !== undefined) return;
    } else if (
      !qname.test(parent ?? "") ||
      !sameDimensions(dimensions, { ...proof.qualifiers, [proof.axis!]: parent }) ||
      !Number.isInteger(proof.totalTableIndex) ||
      proof.totalTableIndex! < 0 ||
      proof.totalTableIndex === proof.tableIndex ||
      period.segments!.some((s) => s.revenueSource?.dimensions[proof.axis!] === parent)
    )
      return;
  }
  const adjustments = period.revenueAdjustments ?? [];
  const reported = adjustments.filter((a) => a.id !== "source-rounding");
  const reconciledRows =
    matrix && !columns && (proof.omittedSubtotals.length > 0 || reported.length > 0);
  const rowKeys = new Set<number>();
  if (
    reconciledRows &&
    (!Number.isInteger(proof.rowIndex) ||
      proof.rowIndex! < 0 ||
      proof.rowIndex! > 500 ||
      !sameDimensions(proof.qualifiers!, {
        "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
      }))
  )
    return;
  const keys = new Set<string>();
  const columnKeys = new Set<number>();
  for (const segment of period.segments!) {
    const source = segment.revenueSource;
    const reviewed = rule?.branches.find((b) => b.label === segment.label);
    const dimensionsValid = rule
      ? !!reviewed &&
        !!source?.dimensions &&
        source.tag === reviewed.tag &&
        source.rowLabel === reviewed.rowLabel &&
        sameDimensions(source.dimensions, reviewed.dimensions)
      : matrix
        ? !!source?.dimensions &&
          source.tag === proof.revenueTag &&
          qname.test(source.dimensions[proof.axis!] ?? "") &&
          sameDimensions(source.dimensions, {
            ...proof.qualifiers,
            [proof.axis!]: source.dimensions[proof.axis!]
          })
        : !!source?.dimensions &&
          Object.keys(source.dimensions).length === (proof.axis ? 1 : 0) &&
          Object.entries(source.dimensions).every(
            ([axis, member]) => axis === proof.axis && qname.test(member)
          );
    if (
      !source ||
      source.sourceUrl !== period.sourceUrl ||
      source.accession !== period.accession ||
      source.filedAt !== period.filedAt ||
      source.startDate !== period.startDate ||
      source.endDate !== period.endDate ||
      source.currency !== period.displayCurrency ||
      source.currency !== period.reportingCurrency ||
      source.value !== segment.revenue ||
      source.tableLabel !== segment.label ||
      !source.tableLabel ||
      !qname.test(source.tag) ||
      !Number.isFinite(halfUnit(source.decimals)) ||
      !source.dimensions ||
      (proof.axis &&
        !isBusinessCategory(proof.axis, source.dimensions[proof.axis], source.tableLabel)) ||
      !dimensionsValid
    )
      return;
    if (columns) {
      if (
        !Number.isInteger(source.columnIndex) ||
        source.columnIndex! < 0 ||
        source.columnIndex! >= proof.columnIndex! ||
        columnKeys.has(source.columnIndex!)
      )
        return;
      columnKeys.add(source.columnIndex!);
    }
    if (reconciledRows) {
      if (
        !Number.isInteger(source.rowIndex) ||
        source.rowIndex! < 0 ||
        source.rowIndex! >= proof.rowIndex! ||
        rowKeys.has(source.rowIndex!) ||
        source.columnIndex !== proof.columnIndex
      )
        return;
      rowKeys.add(source.rowIndex!);
    }
    const key = `${source.tag}|${JSON.stringify(source.dimensions)}`;
    if (keys.has(key)) return;
    keys.add(key);
    const grossSource = segment.grossProfitSource;
    if (
      grossSource &&
      (!grossSource.dimensions ||
        grossSource.revenueTag !== source.tag ||
        JSON.stringify(Object.entries(grossSource.dimensions).sort()) !==
          JSON.stringify(Object.entries(source.dimensions).sort()))
    )
      return;
  }
  if (columns) {
    for (const zero of proof.omittedZeroColumns ?? []) {
      if (
        !isZeroRevenueReconciliation(zero.label, zero.dimensions) ||
        zero.tag !== proof.revenueTag ||
        zero.value !== 0 ||
        !Number.isFinite(halfUnit(zero.decimals)) ||
        !Number.isInteger(zero.columnIndex) ||
        zero.columnIndex < 0 ||
        zero.columnIndex >= proof.columnIndex! ||
        columnKeys.has(zero.columnIndex)
      )
        return;
      columnKeys.add(zero.columnIndex);
    }
    for (const subtotal of proof.omittedSubtotals) {
      const dimensions = subtotal.dimensions;
      const member = dimensions[proof.axis!];
      if (
        !/^(?:total|subtotal)\b/i.test(subtotal.label) ||
        subtotal.tag !== proof.revenueTag ||
        !Number.isFinite(subtotal.value) ||
        subtotal.value < 0 ||
        !Number.isFinite(halfUnit(subtotal.decimals!)) ||
        !Number.isInteger(subtotal.columnIndex) ||
        subtotal.columnIndex! < 0 ||
        subtotal.columnIndex! >= proof.columnIndex! ||
        columnKeys.has(subtotal.columnIndex!) ||
        (Object.keys(dimensions).length &&
          !sameDimensions(dimensions, proof.qualifiers!) &&
          (!qname.test(member ?? "") ||
            !sameDimensions(dimensions, { ...proof.qualifiers, [proof.axis!]: member })))
      )
        return;
      columnKeys.add(subtotal.columnIndex!);
      const preceding = period.segments!.filter(
        (s) => s.revenueSource!.columnIndex! < subtotal.columnIndex!
      );
      const sum = preceding.reduce((sum, s) => sum + s.revenue, 0);
      const bound = preceding.reduce(
        (sum, s) => sum + halfUnit(s.revenueSource!.decimals),
        halfUnit(subtotal.decimals!)
      );
      if (
        preceding.length < 2 ||
        Math.abs(sum - subtotal.value) > bound ||
        Math.abs(sum - subtotal.value) > proof.revenue * 0.001
      )
        return;
    }
  }
  let reportedPrecision = 0;
  if (reconciledRows) {
    if (reported.length !== 1 || proof.omittedSubtotals.length !== 1) return;
    const adjustment = reported[0],
      source = adjustment.revenueSource;
    const subtotal = proof.omittedSubtotals[0];
    if (
      !source ||
      adjustment.id !== "reported-intersegment-eliminations" ||
      !/^(?:inter[ -]?segment (?:revenue |sales )?eliminations?|eliminations? of inter[ -]?segment(?: (?:revenues?|sales))?)$/i.test(
        adjustment.label
      ) ||
      adjustment.revenue > 0 ||
      source.value !== adjustment.revenue ||
      source.tableLabel !== adjustment.label ||
      source.sourceUrl !== period.sourceUrl ||
      source.accession !== period.accession ||
      source.filedAt !== period.filedAt ||
      source.startDate !== period.startDate ||
      source.endDate !== period.endDate ||
      source.currency !== period.displayCurrency ||
      source.currency !== period.reportingCurrency ||
      source.tag !== proof.revenueTag ||
      !Number.isFinite(halfUnit(source.decimals)) ||
      !sameDimensions(source.dimensions, {
        "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
      }) ||
      source.columnIndex !== proof.columnIndex ||
      !Number.isInteger(source.rowIndex) ||
      source.rowIndex! >= proof.rowIndex! ||
      !/^total segment (?:revenues?|sales)$/i.test(subtotal.label) ||
      subtotal.tag !== proof.revenueTag ||
      !sameDimensions(subtotal.dimensions, proof.qualifiers!) ||
      !Number.isFinite(subtotal.value) ||
      subtotal.value <= 0 ||
      !Number.isFinite(halfUnit(subtotal.decimals!)) ||
      subtotal.columnIndex !== proof.columnIndex ||
      !Number.isInteger(subtotal.rowIndex) ||
      subtotal.rowIndex! < 0 ||
      subtotal.rowIndex! >= source.rowIndex! ||
      period.segments!.some((s) => s.revenueSource!.rowIndex! >= subtotal.rowIndex!)
    )
      return;
    const sum = period.segments!.reduce((sum, s) => sum + s.revenue, 0);
    const bound = period.segments!.reduce(
      (sum, s) => sum + halfUnit(s.revenueSource!.decimals),
      halfUnit(subtotal.decimals!)
    );
    if (
      Math.abs(subtotal.value - sum) > bound ||
      Math.abs(subtotal.value - sum) > proof.revenue * 0.001
    )
      return;
    reportedPrecision = halfUnit(source.decimals);
  } else if (reported.length) return;
  const rounding = adjustments.filter((a) => a.id === "source-rounding");
  if (rounding.length > 1 || rounding.some((a) => a.label !== "Source rounding")) return;
  const amount = rounding[0]?.revenue ?? 0;
  const bound = period.segments!.reduce(
    (sum, s) => sum + halfUnit(s.revenueSource!.decimals),
    halfUnit(proof.revenueDecimals) + reportedPrecision
  );
  if (Math.abs(amount) > bound || Math.abs(amount) > proof.revenue * 0.001) return;
  try {
    validateSegmentGrossProfits(period);
  } catch {
    return;
  }
  return business;
}

export function flowPeriod(period: PeriodV2): StatementChartPeriod | undefined {
  if (period.displayCurrency !== "USD") return;
  if (grossOperatingItemsProblem(period)) return;
  if (shareholderBridgeProblem(period)) return;
  if (period.businessBreakdownSource && !businessPeriod(period)) return;
  if (period.operatingNetItems) {
    const statement = period as OperatingNetStatementPeriod;
    return buildStatementFlow(statement).ok ? statement : undefined;
  }
  if (period.directNetItems) {
    const statement = period as DirectNetStatementPeriod;
    return buildStatementFlow(statement).ok ? statement : undefined;
  }
  const required = ["revenue", "pretaxIncome", "incomeTax", "netIncome"] as const;
  if (required.some((key) => !Number.isFinite(period.metrics[key]))) return;
  if (
    period.operatingExpensesBasis &&
    (period.operatingExpensesBasis !== "expenses-and-other-items-net" ||
      period.operatingExpenseDetails?.length ||
      period.metricSources.operatingExpenses?.method !== "calculated" ||
      !Number.isFinite(period.metrics.grossProfit) ||
      !Number.isFinite(period.metrics.operatingIncome) ||
      !Number.isFinite(period.metrics.operatingExpenses))
  )
    return;
  if (Number.isFinite(period.metrics.operatingIncome)) {
    if (!Number.isFinite(period.metrics.grossProfit) && !period.metricSources.totalOperatingCosts)
      return;
  } else if (
    // Only a statement without an operating line may use one net amount before pretax.
    !Number.isFinite(period.metrics.expensesAndOtherItems) ||
    !period.metricSources.expensesAndOtherItems ||
    period.metricSources.expensesAndOtherItems.accession !== period.accession
  )
    return;
  const preciseInputs = (keys: (keyof FinancialMetrics)[]) => {
    if (
      keys.some((key) => {
        const source = period.metricSources[key];
        return (
          !Number.isFinite(period.metrics[key]) ||
          !source ||
          source.method !== "reported" ||
          !Number.isInteger(source.decimals) ||
          source.accession !== period.accession ||
          source.sourceUrl !== period.sourceUrl ||
          source.filedAt !== period.filedAt
        );
      })
    )
      return;
    const bound = keys.reduce(
      (sum, key) => sum + 0.5 * 10 ** -period.metricSources[key]!.decimals!,
      0
    );
    return Number.isFinite(bound) ? bound : undefined;
  };
  const bounded = (amount: number, bound: number | undefined) =>
    bound !== undefined &&
    Number.isFinite(amount) &&
    Math.abs(amount) <= bound &&
    Math.abs(amount) <= Math.abs(period.metrics.revenue!) * 0.001;
  for (const [item, keys] of [
    [
      period.operatingReconciliation,
      period.operatingReconciliation?.basis === "gross-profit"
        ? ["grossProfit", "operatingExpenses", "operatingIncome"]
        : ["revenue", "totalOperatingCosts", "operatingIncome"]
    ],
    [
      period.afterTaxReconciliation,
      [
        "pretaxIncome",
        "incomeTax",
        "netIncome",
        ...(
          [
            "equityMethodIncome",
            "afterTaxSubsidiaryIncome",
            "afterTaxTransactionIncome",
            "discontinuedOperationsIncome",
            "noncontrollingInterestIncome"
          ] as const
        ).filter((key) => period.metrics[key] !== undefined)
      ]
    ]
  ] as [FinancialPeriod["afterTaxReconciliation"], (keyof FinancialMetrics)[]][]) {
    if (!item) continue;
    if (
      item.label !== "Source rounding" ||
      item.sourceUrl !== period.sourceUrl ||
      !Number.isFinite(item.amount)
    )
      return;
    const bound =
      item === period.operatingReconciliation && period.grossOperatingItems
        ? grossOperatingRoundingBound(period.grossOperatingItems)
        : preciseInputs(keys);
    if (!bounded(item.amount, bound)) return;
  }
  if (
    period.operatingReconciliation?.basis !== undefined &&
    period.operatingReconciliation.basis !== "gross-profit"
  )
    return;
  if (
    period.operatingReconciliation?.basis === "gross-profit" &&
    !period.grossOperatingItems &&
    !["us-gaap:OperatingExpenses", "ifrs-full:OperatingExpense"].includes(
      period.metricSources.operatingExpenses?.tag ?? ""
    )
  )
    return;
  if (
    period.afterTaxReconciliation &&
    ![
      "us-gaap:NetIncomeLoss",
      "us-gaap:ProfitLoss",
      "ifrs-full:ProfitLoss",
      "ifrs-full:ProfitLossAttributableToOwnersOfParent"
    ].includes(period.metricSources.netIncome?.tag ?? "")
  )
    return;
  if (period.consolidatedIncomeSubtotal) {
    const item = period.consolidatedIncomeSubtotal;
    const bound = preciseInputs(["pretaxIncome", "incomeTax"]);
    const difference = item.amount - (period.metrics.pretaxIncome! - period.metrics.incomeTax!);
    if (
      !item.label ||
      item.sourceUrl !== period.sourceUrl ||
      !["us-gaap:ProfitLoss", "ifrs-full:ProfitLoss"].includes(item.tag) ||
      !Number.isInteger(item.decimals) ||
      !bounded(difference, bound === undefined ? undefined : bound + 0.5 * 10 ** -item.decimals)
    )
      return;
  }
  if (period.roundedOperatingExpenseComponents) {
    const item = period.roundedOperatingExpenseComponents;
    const keys = [
      "operatingExpenses",
      "researchAndDevelopment",
      "sellingGeneralAndAdministrative"
    ] as const;
    const sum = item.components.reduce((sum, line) => sum + line.amount, 0);
    if (
      item.sourceUrl !== period.sourceUrl ||
      item.components.length !== 2 ||
      new Set(item.components.map((line) => line.tag)).size !== 2 ||
      period.operatingExpenseDetails?.length ||
      period.operatingExpensesBasis ||
      !["us-gaap:OperatingExpenses", "ifrs-full:OperatingExpense"].includes(
        period.metricSources.operatingExpenses?.tag ?? ""
      ) ||
      item.components.some((line) => {
        const key =
          line.tag === "us-gaap:ResearchAndDevelopmentExpense"
            ? "researchAndDevelopment"
            : line.tag === "us-gaap:SellingGeneralAndAdministrativeExpense"
              ? "sellingGeneralAndAdministrative"
              : undefined;
        return (
          !key ||
          !line.label ||
          line.amount < 0 ||
          line.amount !== period.metrics[key] ||
          line.tag !== period.metricSources[key]?.tag ||
          line.decimals !== period.metricSources[key]?.decimals
        );
      }) ||
      item.difference === 0 ||
      item.difference !== period.metrics.operatingExpenses! - sum ||
      !bounded(item.difference, preciseInputs([...keys]))
    )
      return;
  }
  const statement = period as FlowStatementPeriod;
  return buildStatementFlow(statement).ok ? statement : undefined;
}

export function upgradePeriod(period: FinancialPeriod): PeriodV2 {
  const metricSources: PeriodV2["metricSources"] = {};
  for (const key of Object.keys(period.metrics) as (keyof FinancialMetrics)[]) {
    if (period.metrics[key] === undefined) continue;
    metricSources[key] = {
      label: key,
      tag: "reviewed-filing-adapter",
      accession: period.accession ?? "",
      filedAt: period.filedAt,
      sourceUrl: period.sourceUrl,
      method: period.derived ? "calculated" : "reported"
    };
  }
  return {
    ...period,
    metrics: Object.fromEntries(
      Object.entries(period.metrics).filter(([, value]) => value !== undefined)
    ),
    metricSources,
    coverage: {
      basics: true,
      segments: !!period.segments?.length,
      sankey: buildStatementFlow(period).ok
    }
  };
}

export function upgradeCompany(company: CompanyDataset): CompanyV2 {
  return {
    ...company,
    schemaVersion: 2,
    annual: company.annual.map(upgradePeriod),
    quarterly: company.quarterly.map(upgradePeriod),
    warnings: []
  };
}

export function validateV2(company: CompanyV2) {
  if (
    company.schemaVersion !== 2 ||
    !/^\d{10}$/.test(company.cik) ||
    !["verified", "delayed"].includes(company.dataStatus) ||
    !company.version ||
    !Number.isFinite(Date.parse(company.updatedAt)) ||
    Date.parse(company.updatedAt) > Date.now() + 60000 ||
    typeof company.name !== "string" ||
    !Array.isArray(company.warnings) ||
    !Array.isArray(company.annual) ||
    !Array.isArray(company.quarterly)
  )
    throw new Error("Unverified company identity or schema.");
  if (![...company.annual, ...company.quarterly].length)
    throw new Error("No source-available financial periods.");
  for (const kind of ["annual", "quarterly"] as const) {
    const ids = new Set<string>();
    for (const p of company[kind]) {
      if (ids.has(p.id) || p.kind !== kind) throw new Error("Duplicate or misplaced period.");
      ids.add(p.id);
      const issuerSource = (value: string) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "www.sec.gov" &&
          url.pathname.startsWith(`/Archives/edgar/data/${Number(company.cik)}/`) &&
          !url.username &&
          !url.password
        );
      };
      if (
        !issuerSource(p.sourceUrl) ||
        !/^[A-Z]{3}$/.test(p.displayCurrency) ||
        !p.coverage ||
        !Number.isInteger(p.fiscalYear) ||
        (kind === "quarterly" && ![1, 2, 3, 4].includes(p.fiscalQuarter!))
      )
        throw new Error("Invalid period identity, currency or source.");
      if (
        ![p.startDate, p.endDate, p.filedAt].every(
          (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
        ) ||
        p.startDate >= p.endDate ||
        p.endDate > p.filedAt ||
        p.filedAt > new Date().toISOString().slice(0, 10)
      )
        throw new Error("Invalid financial period dates.");
      const entries = Object.entries(p.metrics) as [keyof FinancialMetrics, number][];
      if (
        !entries.length ||
        entries.some(([key, value]) => !Number.isFinite(value) || !p.metricSources[key])
      )
        throw new Error("Missing metric provenance.");
      for (const [, source] of Object.entries(p.metricSources) as [string, MetricSource][]) {
        if (
          !issuerSource(source.sourceUrl) ||
          !["reported", "calculated"].includes(source.method) ||
          !source.tag ||
          !source.label ||
          source.filedAt !== p.filedAt
        )
          throw new Error("Metric source does not match the SEC issuer.");
      }
      const m = p.metrics;
      validateSegmentGrossProfits(p);
      const adjustments = p.grossProfitAdjustments ?? [];
      if (
        adjustments.some(
          (item) => !item.label || !Number.isFinite(item.amount) || item.sourceUrl !== p.sourceUrl
        )
      )
        throw new Error("Invalid reported gross profit adjustment provenance.");
      const tol = roundingTolerance(m.revenue ?? m.netIncome ?? 1);
      if (
        m.revenue !== undefined &&
        m.costOfRevenue !== undefined &&
        m.grossProfit !== undefined &&
        Math.abs(
          m.revenue -
            m.costOfRevenue +
            adjustments.reduce((sum, item) => sum + item.amount, 0) -
            m.grossProfit
        ) > tol
      )
        throw new Error("Gross profit does not reconcile.");
      if (
        m.grossProfit !== undefined &&
        m.operatingExpenses !== undefined &&
        m.operatingIncome !== undefined &&
        Math.abs(
          m.grossProfit +
            (p.operatingReconciliation?.basis === "gross-profit"
              ? p.operatingReconciliation.amount
              : 0) -
            m.operatingExpenses -
            m.operatingIncome
        ) > tol
      )
        throw new Error("Operating profit does not reconcile.");
      // NetIncomeLoss and ProfitLoss can differ in noncontrolling/equity scope.
      // Only claim a full statement when the reviewed accounting contract passes.
      if (p.coverage.segments) {
        if (!businessPeriod(p)) throw new Error("Unsupported business chart capability.");
      }
      if (p.businessBreakdownSource && !p.coverage.segments)
        throw new Error("Business provenance requires validated coverage.");
      if (
        (p.coverage.sankey ||
          p.operatingReconciliation ||
          p.operatingExpensesBasis ||
          p.afterTaxReconciliation ||
          p.consolidatedIncomeSubtotal ||
          p.roundedOperatingExpenseComponents ||
          p.shareholderBridge ||
          p.operatingItems ||
          p.grossOperatingItems ||
          p.directNetItems ||
          p.operatingNetItems) &&
        !flowPeriod(p)
      )
        throw new Error("Unsupported chart capability or unverified rounding precision.");
    }
  }
}

/** Never splice basic facts into an older detailed statement: keep each version coherent. */
export function mergeV2(previous: CompanyV2 | undefined, incoming: CompanyV2): CompanyV2 {
  validateV2(incoming);
  if (previous && previous.cik !== incoming.cik) throw new Error("Issuer mismatch.");
  const merged = { ...incoming, warnings: [...new Set(incoming.warnings)] };
  for (const kind of ["annual", "quarterly"] as const) {
    const byDates = new Map(
      (previous?.[kind] ?? []).map((p) => [`${p.startDate}:${p.endDate}`, p])
    );
    for (const p of incoming[kind]) {
      const key = `${p.startDate}:${p.endDate}`;
      const old = byDates.get(key);
      if (old && (old.filedAt > p.filedAt || (old.coverage.segments && !p.coverage.segments))) {
        if (p.filedAt > old.filedAt)
          merged.warnings.push(
            `${p.label}: a newer basic filing exists, but the prior coherent business breakdown is retained until its updated adapter validates. Displayed figures cite ${old.filedAt}.`
          );
        continue;
      }
      if (
        old &&
        p.filedAt === old.filedAt &&
        old.accession === p.accession &&
        old.coverage.sankey &&
        !p.coverage.sankey
      )
        continue;
      if (
        old &&
        p.filedAt === old.filedAt &&
        !(p.coverage.sankey && !old.coverage.sankey) &&
        Object.keys(old.metrics).length > Object.keys(p.metrics).length
      )
        continue;
      if (old && sameStatementExceptSegmentGrossProfit(old, p)) {
        // A legacy same-filing response may omit optional gross-profit fields.
        // Retain only the missing source/value pairs; never splice across filings
        // or across a changed category, currency, amount, or statement metric.
        byDates.set(key, {
          ...p,
          segments: p.segments?.map((segment) => {
            const prior = old.segments?.find((candidate) => candidate.id === segment.id);
            return segment.grossProfit === undefined && prior?.grossProfit !== undefined
              ? {
                  ...segment,
                  grossProfit: prior.grossProfit,
                  grossProfitSource: prior.grossProfitSource
                }
              : segment;
          })
        });
        continue;
      }
      byDates.set(key, p);
    }
    merged[kind] = [...byDates.values()]
      .sort((a, b) => a.endDate.localeCompare(b.endDate))
      .slice(kind === "annual" ? -10 : -20);
  }
  merged.latestPeriod = [...merged.annual, ...merged.quarterly]
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .at(-1)!.label;
  const latestEnd = [...merged.annual, ...merged.quarterly]
    .map((p) => p.endDate)
    .sort()
    .at(-1)!;
  merged.warnings = merged.warnings.filter((warning) => {
    const lag = warning.match(
      /^SEC lists a report ending (\d{4}-\d{2}-\d{2}), but supported standard facts currently reach only/
    );
    return !lag || lag[1] > latestEnd;
  });
  validateV2(merged);
  return merged;
}

function sameStatementExceptSegmentGrossProfit(a: PeriodV2, b: PeriodV2) {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  const withoutGrossProfit = (period: PeriodV2) => ({
    ...period,
    segments: period.segments?.map((segment) => ({
      id: segment.id,
      label: segment.label,
      revenue: segment.revenue
    }))
  });
  return stable(withoutGrossProfit(a)) === stable(withoutGrossProfit(b));
}
