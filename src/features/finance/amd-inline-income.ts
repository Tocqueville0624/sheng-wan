import type { AmdInlineIncomeProof } from "./amd-types";
import type { PeriodV2 } from "./v2-types";
import type { FinancialMetrics, FlowStatementPeriod } from "./types";
import { amdIncomeProfiles } from "./amd-income-profiles";
import { decodeOriginalRows, originalCellEncoding } from "./original-cell-tuples";
import {
  originalReviewedMillionDollarRows,
  originalExactMillionDollars
} from "./original-revenue-rows";
import {
  demandAmdSource as demand,
  validateAmdSourceFocus,
  originalAmdPrimaryColumns
} from "./amd-source";

const gaap = (s: string) => `us-gaap:${s}`;
const primaryPretax = gaap(
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
);
const inclusivePretax = gaap(
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
);
const anchors = {
  revenue: gaap("RevenueFromContractWithCustomerExcludingAssessedTax"),
  costOfRevenue: gaap("CostOfGoodsAndServicesSold"),
  grossProfit: gaap("GrossProfit"),
  operatingIncome: gaap("OperatingIncomeLoss"),
  pretaxIncome: primaryPretax,
  incomeTax: gaap("IncomeTaxExpenseBenefit"),
  netIncome: gaap("NetIncomeLoss"),
  researchAndDevelopment: gaap("ResearchAndDevelopmentExpense"),
  sellingGeneralAndAdministrative: gaap("SellingGeneralAndAdministrativeExpense"),
  equityMethodIncome: gaap("IncomeLossFromEquityMethodInvestments"),
  discontinuedOperationsIncome: gaap(
    "IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToReportingEntity"
  )
} as const;

/** Replay every original current/comparative/YTD column. This returns a chart
 * view only: the period's saved metrics and all their sources stay untouched. */
export function originalAmdInlineIncome(p: PeriodV2, proof: AmdInlineIncomeProof) {
  demand(
    proof.ruleId === "amd-original-complete-income-v1" &&
      proof.encoding === originalCellEncoding &&
      Object.keys(proof).every((k) =>
        [
          "ruleId",
          "encoding",
          "tableIndex",
          "title",
          "rows",
          "reportDate",
          "form",
          "originalFiscalYear",
          "originalFiscalPeriod",
          "fiscalCalendar",
          "units"
        ].includes(k)
      ),
    "Changed original AMD income envelope"
  );
  validateAmdSourceFocus(p, proof);
  const rows = decodeOriginalRows(proof.rows);
  demand(
    rows.length >= 16 && rows.length <= 40 && rows.every((r, i) => r.rowIndex === i),
    "Incomplete original AMD income rows"
  );
  originalReviewedMillionDollarRows(rows, proof.units, "0000002488");
  const money = rows.filter((r) => r.cells.some((c) => c.fact)),
    revenue = money[0],
    tax = money.find((r) => r.cells.some((c) => c.fact?.tag === anchors.incomeTax));
  demand(revenue && tax && money.at(-1) === rows.at(-1), "Missing original AMD income endpoints");
  const columns = originalAmdPrimaryColumns({
    ...proof,
    primary: {
      tableIndex: proof.tableIndex,
      title: proof.title,
      headerRows: rows.slice(0, revenue.rowIndex),
      revenue,
      tax
    }
  });
  const profiles = amdIncomeProfiles.filter(
    (profile) =>
      profile.rows.length === money.length &&
      profile.rows.every((meaning, i) => {
        const r = money[i],
          cells = r.cells.filter((c) => c.fact);
        return (
          r.cells[0].label === meaning.label &&
          cells.length === columns.length &&
          cells.every(
            (c) =>
              c.fact!.tag === meaning.tag &&
              c.fact!.decimals === -6 &&
              !Object.keys(c.fact!.dimensions).length
          )
        );
      })
  );
  demand(profiles.length === 1, "Unreviewed original AMD complete income classification");
  for (const r of rows.slice(revenue.rowIndex)) {
    demand(
      !r.cells[0].fact && r.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label)),
      "Unaccounted original AMD income amount"
    );
    if (!r.cells.some((c) => c.fact))
      demand(
        ["", "Operating expenses:"].includes(r.cells[0].label),
        "Unreviewed original AMD income section"
      );
  }
  let selected:
    | {
        metrics: Partial<FinancialMetrics>;
        primaryPretaxLabel: string;
        retainedPretaxIncludesEquity: boolean;
      }
    | undefined;
  for (const column of columns) {
    const ledger = money.map((r) => {
      const cells = r.cells.filter(
        (c) =>
          c.fact?.startDate === column.scope.start &&
          c.fact.endDate === column.scope.end &&
          c.columnIndex >= column.dateColumn.columnIndex &&
          c.columnIndex + c.span <= column.dateColumn.columnIndex + column.dateColumn.span
      );
      demand(cells.length === 1, "Missing original AMD complete income column");
      return { row: r, cell: cells[0], exact: originalExactMillionDollars(cells[0]) };
    });
    const find = (tag: string) => {
      const matches = ledger.filter((r) => r.cell.fact!.tag === tag);
      demand(matches.length <= 1, "Duplicate original AMD income subtotal");
      return matches[0];
    };
    const need = (tag: string) => {
      const r = find(tag);
      demand(r, "Missing original AMD income anchor");
      return r;
    };
    const r = need(anchors.revenue),
      g = need(anchors.grossProfit),
      o = need(anchors.operatingIncome),
      pre = need(primaryPretax),
      t = need(anchors.incomeTax),
      eq = need(anchors.equityMethodIncome),
      net = need(anchors.netIncome),
      disc = find(anchors.discontinuedOperationsIncome);
    demand(
      ledger.indexOf(pre) + 1 === ledger.indexOf(t) && ledger.indexOf(t) + 1 === ledger.indexOf(eq),
      "Changed original AMD after-tax order"
    );
    const grossCosts = ledger.slice(ledger.indexOf(r) + 1, ledger.indexOf(g)),
      costSubtotal = find(anchors.costOfRevenue);
    demand(costSubtotal && grossCosts.includes(costSubtotal), "Missing original AMD cost subtotal");
    const costLeaves = grossCosts.filter((l) => l !== costSubtotal);
    demand(
      !costLeaves.length || costLeaves.reduce((n, l) => n + l.exact, 0n) === costSubtotal.exact,
      "Original AMD gross costs differ"
    );
    demand(r.exact - costSubtotal.exact === g.exact, "Original AMD gross profit differs");
    const operating = ledger.slice(ledger.indexOf(g) + 1, ledger.indexOf(o)),
      reportedOpex = find(gaap("OperatingExpenses")),
      leaves = operating.filter((l) => l !== reportedOpex),
      netOpex = leaves.reduce(
        (n, l) =>
          n +
          (/^amd:Gain(?:Loss)?OnLicensingAgreement$/.test(l.cell.fact!.tag) ? -l.exact : l.exact),
        0n
      );
    demand(
      (!reportedOpex || reportedOpex.exact === netOpex) &&
        g.exact - netOpex === o.exact &&
        netOpex >= 0n,
      "Original AMD operating ledger differs"
    );
    const between = ledger.slice(ledger.indexOf(o) + 1, ledger.indexOf(pre));
    demand(
      between.length === 2 &&
        between[0].cell.fact!.tag === gaap("InterestExpense") &&
        between[1].cell.fact!.tag === gaap("OtherNonoperatingIncomeExpense") &&
        o.exact - between[0].exact + between[1].exact === pre.exact,
      "Original AMD pretax ledger differs"
    );
    const continuing = pre.exact - t.exact + eq.exact,
      continuingSubtotal = find(gaap("IncomeLossFromContinuingOperations"));
    demand(
      (!continuingSubtotal || continuingSubtotal.exact === continuing) &&
        continuing + (disc?.exact ?? 0n) === net.exact,
      "Original AMD after-tax ledger differs"
    );
    if (column.scope.start !== p.startDate || column.scope.end !== p.endDate) continue;
    const metrics: Partial<FinancialMetrics> = { operatingExpenses: Number(netOpex) };
    for (const [key, tag] of Object.entries(anchors)) {
      const line = find(tag);
      if (line) metrics[key as keyof FinancialMetrics] = Number(line.exact);
    }
    let retainedPretaxIncludesEquity = false;
    for (const [key, value] of Object.entries(p.metrics)) {
      const k = key as keyof FinancialMetrics,
        source = p.metricSources[k];
      demand(
        metrics[k] !== undefined &&
          source &&
          source.accession === p.accession &&
          source.sourceUrl === p.sourceUrl &&
          source.filedAt === p.filedAt,
        "Uncorroborated saved AMD income metric"
      );
      demand(
        source.decimals === undefined || source.decimals === -6,
        "Saved AMD income precision differs from original declaration"
      );
      if (k === "operatingExpenses") {
        demand(
          (source.method === "reported" &&
            source.tag === gaap("OperatingExpenses") &&
            !!reportedOpex) ||
            (source.method === "calculated" &&
              source.tag === "grossProfit - operatingIncome" &&
              source.inputs?.length === 2 &&
              source.inputs.every((input) => input === p.sourceUrl)),
          "Unreviewed saved AMD operating subtotal provenance"
        );
      } else demand(source.method === "reported", "Changed saved AMD reported metric method");
      if (k === "pretaxIncome" && value !== metrics[k]) {
        demand(
          source.method === "reported" &&
            source.tag === inclusivePretax &&
            value === Number(pre.exact + eq.exact),
          "Saved AMD pretax scope is not original pretax plus reported equity"
        );
        retainedPretaxIncludesEquity = true;
      } else
        demand(
          value === metrics[k],
          "Saved AMD financial value differs from original complete ledger"
        );
      if (k !== "pretaxIncome" && k !== "operatingExpenses")
        demand(
          source.tag === anchors[k as keyof typeof anchors],
          "Saved AMD income metric has a different concept"
        );
      if (k === "pretaxIncome" && !retainedPretaxIncludesEquity)
        demand(
          [primaryPretax, inclusivePretax].includes(source.tag),
          "Unreviewed saved AMD pretax concept"
        );
    }
    demand(!selected, "Duplicate selected original AMD income scope");
    selected = {
      metrics,
      primaryPretaxLabel: pre.row.cells[0].label,
      retainedPretaxIncludesEquity
    };
  }
  demand(selected, "Selected AMD scope absent from original complete income ledger");
  return selected;
}

/** Internal projection for the graph. Stored facts remain available in period
 * tables, CSV and SVG metadata; only original statement scopes enter the flow. */
export function amdIncomeFlowView(p: PeriodV2): FlowStatementPeriod {
  demand(p.amdInlineIncome, "Missing original AMD income proof");
  demand(
    !p.alignInlineIncome &&
      !p.dardenInlineIncome &&
      !p.originalStatementCorroboration &&
      !p.grossOperatingItems &&
      !p.operatingItems &&
      !p.directNetItems &&
      !p.operatingNetItems &&
      !p.shareholderBridge &&
      !p.afterTaxTransactionItems &&
      !p.operatingReconciliation &&
      !p.afterTaxReconciliation &&
      !p.consolidatedIncomeSubtotal &&
      !p.roundedOperatingExpenseComponents &&
      !p.grossProfitAdjustments?.length,
    "Mixed original AMD income contracts"
  );
  const result = originalAmdInlineIncome(p, p.amdInlineIncome);
  const view = {
    ...p,
    metrics: result.metrics,
    operatingExpensesBasis: "expenses-and-other-items-net" as const
  };
  delete view.amdInlineIncome;
  delete view.operatingExpenseDetails;
  delete view.operatingCostDetails;
  return view as FlowStatementPeriod;
}
