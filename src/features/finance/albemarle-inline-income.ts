import type { GrossOperatingItems, ServiceRevenueRow, ServiceRevenueRowsProof } from "./types";
import type { PeriodV2 } from "./v2-types";
import { originalThousandDollarRows } from "./original-revenue-rows";

export const albInlineIncomeRule = "alb-original-inline-operating-gains-v1";
export type AlbemarleInlineIncomeProof = {
  ruleId: typeof albInlineIncomeRule;
  reportDate: string;
  form: string;
  originalFiscalYear: number;
  title: string;
  tableIndex: number;
  units: ServiceRevenueRowsProof["units"];
  /** Actual primary rows through parent income; EPS and share counts are outside this scope. */
  rows: ServiceRevenueRow[];
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
function demand(v: unknown, reason: string): asserts v {
  if (!v) throw Error(reason);
}
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const meanings: Record<number, [string, string]> = {
  3: ["Net sales", "us-gaap:Revenues"],
  4: ["Cost of goods sold", "us-gaap:CostOfRevenue"],
  5: ["Gross profit", "us-gaap:GrossProfit"],
  6: [
    "Selling, general and administrative expenses",
    "us-gaap:SellingGeneralAndAdministrativeExpense"
  ],
  7: ["Research and development expenses", "us-gaap:ResearchAndDevelopmentExpense"],
  9: ["(Gain) loss on sale of business/interest in properties", "us-gaap:GainLossOnSaleOfBusiness"],
  11: ["Operating profit", "us-gaap:OperatingIncomeLoss"],
  12: ["Interest and financing expenses", "us-gaap:InterestAndDebtExpense"],
  13: ["Other income, net", "us-gaap:OtherNonoperatingIncomeExpense"],
  14: [
    "Income before income taxes and equity in net income of unconsolidated investments",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
  ],
  15: ["Income tax expense", "us-gaap:IncomeTaxExpenseBenefit"],
  16: [
    "Income before equity in net income of unconsolidated investments",
    "alb:IncomeBeforeEquityInNetIncomeOfUnconsolidatedInvestments"
  ],
  17: [
    "Equity in net income of unconsolidated investments (net of tax)",
    "us-gaap:IncomeLossFromEquityMethodInvestments"
  ],
  18: ["Net income", "us-gaap:ProfitLoss"],
  19: [
    "Net income attributable to noncontrolling interests",
    "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest"
  ],
  20: ["Net income attributable to Albemarle Corporation", "us-gaap:NetIncomeLoss"]
};
const metricRows = {
  revenue: 3,
  costOfRevenue: 4,
  grossProfit: 5,
  sellingGeneralAndAdministrative: 6,
  researchAndDevelopment: 7,
  operatingIncome: 11,
  pretaxIncome: 14,
  incomeTax: 15,
  equityMethodIncome: 17,
  noncontrollingInterestIncome: 19,
  netIncome: 20
} as const;

/** Replay every original column and the six distinct income identities. A sale
 * gain is economic income despite its parenthesized expense-table presentation. */
export function originalAlbemarleInlineIncome(p: PeriodV2, proof: AlbemarleInlineIncomeProof) {
  const url = new URL(p.sourceUrl),
    year = Number(proof.reportDate.slice(0, 4));
  demand(
    p.accession &&
      /^\d{10}-\d{2}-\d{6}$/.test(p.accession) &&
      url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/Archives/edgar/data/915913/${p.accession.replaceAll("-", "")}/`) &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      proof.ruleId === albInlineIncomeRule &&
      /^10-Q(?:\/A)?$/.test(proof.form) &&
      date(proof.reportDate) &&
      proof.reportDate.endsWith("-06-30") &&
      date(p.filedAt) &&
      proof.reportDate <= p.filedAt &&
      proof.originalFiscalYear === year &&
      /^Albemarle Corporation and Subsidiaries CONSOLIDATED STATEMENTS OF INCOME$/i.test(
        proof.title
      ) &&
      Number.isInteger(proof.tableIndex) &&
      proof.tableIndex >= 0 &&
      proof.tableIndex < 5000 &&
      p.kind === "quarterly" &&
      p.fiscalQuarter === 2 &&
      [year, year - 1].includes(p.fiscalYear) &&
      p.id === `${p.fiscalYear}-Q2` &&
      p.startDate === `${p.fiscalYear}-04-01` &&
      p.endDate === `${p.fiscalYear}-06-30`,
    "Invalid original Albemarle quarterly income source or fiscal column."
  );
  demand(
    Array.isArray(proof.units) &&
      proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Invalid original income units."
  );
  demand(
    Array.isArray(proof.rows) &&
      proof.rows.length === 21 &&
      proof.rows.every((r, i) => r.rowIndex === i),
    "Missing or reordered original income rows."
  );
  originalThousandDollarRows(proof.rows, proof.units, "0000915913");
  for (const i of [0, 8, 10])
    demand(
      proof.rows[i].cells.every((c) => !c.fact && !c.label),
      "Changed original blank spacer."
    );
  const labeled = (i: number) => proof.rows[i].cells.filter((c) => c.label);
  demand(
    canonical(labeled(1).map((c) => [c.columnIndex, c.span, c.label])) ===
      canonical([
        [3, 9, "Three Months Ended June 30,"],
        [15, 9, "Six Months Ended June 30,"]
      ]) &&
      proof.rows[1].cells.every((c) => !c.fact) &&
      proof.rows[2].cells.every((c) => !c.fact) &&
      canonical(labeled(2).map((c) => [c.columnIndex, c.span, c.label])) ===
        canonical([
          [3, 3, String(year)],
          [9, 3, String(year - 1)],
          [15, 3, String(year)],
          [21, 3, String(year - 1)]
        ]),
    "Changed original quarter, comparative or YTD headings."
  );
  const dates = [
    [`${year}-04-01`, `${year}-06-30`, 3],
    [`${year - 1}-04-01`, `${year - 1}-06-30`, 9],
    [`${year}-01-01`, `${year}-06-30`, 15],
    [`${year - 1}-01-01`, `${year - 1}-06-30`, 21]
  ] as const;
  const columns = dates.map(([start, end, column]) => {
    const line = (index: number) => {
      const r = proof.rows[index],
        meaning = meanings[index];
      demand(
        r.cells[0].label === meaning[0] &&
          !r.cells[0].fact &&
          r.cells.filter((c) => c.fact).length === 4,
        "Changed or incomplete original income line."
      );
      const selected = r.cells.filter((c) => c.fact?.startDate === start && c.fact.endDate === end);
      demand(selected.length === 1, "Missing or ambiguous original income date.");
      const c = selected[0],
        f = c.fact!;
      demand(
        f.tag === meaning[1] &&
          !Object.keys(f.dimensions).length &&
          c.columnIndex >= column &&
          c.columnIndex + c.span <= column + 3 &&
          r.cells.slice(1).every((x) => x.fact || /^(?:\$|[—–-])?$/.test(x.label)),
        "Foreign or unaccounted original income declaration."
      );
      return {
        id: `alb-inline-income-${index}`,
        label: meaning[0],
        tag: f.tag,
        amount: f.value,
        decimals: f.decimals,
        rowIndex: index,
        displayed: c.label
      };
    };
    const lines = Object.fromEntries(Object.keys(meanings).map((i) => [i, line(Number(i))]));
    const v = (i: number) => lines[i].amount;
    demand(
      v(3) > 0 && [4, 6, 7, 12, 19].every((i) => v(i) >= 0),
      "Unreviewed negative source cost or attribution."
    );
    for (const i of [12, 19])
      demand(
        v(i) === 0 ? /^[—–-]$/.test(lines[i].displayed) : /^\(.*\)$/.test(lines[i].displayed),
        "Changed displayed income deduction."
      );
    demand(
      v(9) === 0
        ? /^[—–-]$/.test(lines[9].displayed)
        : /^\(.*\)$/.test(lines[9].displayed) === v(9) > 0,
      "Business-sale fact sign differs from its original expense presentation."
    );
    demand(
      v(3) - v(4) === v(5) &&
        v(5) - v(6) - v(7) + v(9) === v(11) &&
        v(11) - v(12) + v(13) === v(14) &&
        v(14) - v(15) === v(16) &&
        v(16) + v(17) === v(18) &&
        v(18) - v(19) === v(20),
      "Original quarterly income scopes do not reconcile exactly."
    );
    return { start, end, lines };
  });
  const selected = columns.find((c) => c.start === p.startDate && c.end === p.endDate)!;
  const row = (i: number) => {
    const l = selected.lines[i];
    return {
      id: l.id,
      label: l.label,
      tag: l.tag,
      amount: l.amount,
      decimals: l.decimals,
      rowIndex: l.rowIndex
    };
  };
  const gain = row(9);
  const sale = {
    ...gain,
    amount: gain.amount === 0 ? 0 : -gain.amount,
    label:
      gain.amount > 0
        ? "Gain on sale of business / interest in properties"
        : gain.amount < 0
          ? "Loss on sale of business / interest in properties"
          : gain.label
  };
  const ledger: GrossOperatingItems = {
    ruleId: albInlineIncomeRule,
    sourceUrl: p.sourceUrl,
    accession: p.accession,
    filedAt: p.filedAt,
    startDate: p.startDate,
    endDate: p.endDate,
    currency: "USD",
    tableIndex: proof.tableIndex,
    revenue: row(3),
    cost: row(4),
    grossCosts: [],
    grossProfit: row(5),
    operatingCosts: [row(6), row(7), sale],
    operatingIncome: row(11),
    inlineSource: proof
  };
  const metrics = Object.fromEntries(
    Object.entries(metricRows).map(([key, i]) => [key, row(i).amount])
  ) as PeriodV2["metrics"];
  metrics.operatingExpenses = ledger.operatingCosts.reduce((sum, l) => sum + l.amount, 0);
  const metricSources = Object.fromEntries(
    Object.entries(metricRows).map(([key, i]) => [
      key,
      {
        label: row(i).label,
        tag: row(i).tag,
        accession: p.accession,
        filedAt: p.filedAt,
        sourceUrl: p.sourceUrl,
        method: "reported",
        decimals: -3
      }
    ])
  ) as PeriodV2["metricSources"];
  metricSources.operatingExpenses = {
    label: "Sum of original operating expense and business-sale gain lines (net)",
    tag: "us-gaap:SellingGeneralAndAdministrativeExpense + us-gaap:ResearchAndDevelopmentExpense - us-gaap:GainLossOnSaleOfBusiness",
    sourceUrl: p.sourceUrl,
    accession: p.accession,
    filedAt: p.filedAt,
    method: "calculated",
    inputs: ledger.operatingCosts.map(
      (l) => `${l.label} (${l.tag}), displayed expense effect ${l.amount}: ${p.sourceUrl}`
    )
  };
  return { ledger, metrics, metricSources };
}

export function albemarleInlineIncomeProblem(p: PeriodV2): string | undefined {
  try {
    const ledger = p.grossOperatingItems;
    demand(ledger?.inlineSource, "Missing original inline income proof.");
    const expected = originalAlbemarleInlineIncome(p, ledger.inlineSource);
    demand(
      canonical(ledger) === canonical(expected.ledger),
      "Altered original inline income ledger."
    );
    for (const [key, value] of Object.entries(expected.metrics)) {
      const k = key as keyof PeriodV2["metrics"],
        s = p.metricSources[k],
        correct = expected.metricSources[k]!;
      demand(
        p.metrics[k] === value &&
          s?.method === correct.method &&
          s.sourceUrl === p.sourceUrl &&
          s.accession === p.accession &&
          s.filedAt === p.filedAt,
        "Changed original quarterly amount or provenance."
      );
      if (k === "operatingExpenses")
        demand(
          s.decimals === undefined &&
            (canonical(s) === canonical(correct) ||
              (s.label === "operatingExpenses" &&
                s.tag === "grossProfit - operatingIncome" &&
                canonical(s.inputs) === canonical([p.sourceUrl, p.sourceUrl]))),
          "Unreviewed original net operating expense calculation."
        );
      else
        demand(
          s.tag === correct.tag &&
            (s.decimals === undefined || s.decimals === -3) &&
            !s.inputs?.length,
          "Changed original quarterly metric concept or precision."
        );
    }
    demand(
      p.operatingExpensesBasis === "expenses-and-other-items-net" &&
        p.metrics.discontinuedOperationsIncome === undefined &&
        p.metrics.afterTaxSubsidiaryIncome === undefined &&
        p.metrics.afterTaxTransactionIncome === undefined &&
        !p.operatingExpenseDetails?.length &&
        !p.operatingCostDetails?.length &&
        !p.operatingItems &&
        !p.directNetItems &&
        !p.operatingNetItems &&
        !p.roundedOperatingExpenseComponents &&
        !p.operatingReconciliation &&
        !p.grossProfitAdjustments?.length &&
        !p.afterTaxReconciliation &&
        !p.afterTaxTransactionItems &&
        !p.consolidatedIncomeSubtotal &&
        !p.shareholderBridge &&
        !ledger.standaloneSource,
      "Competing original quarterly income interpretation."
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid original inline income proof.";
  }
}

/** Retain every existing amount and source; only absent original facts are added. */
export function enrichOriginalAlbemarleInlineIncome(
  p: PeriodV2,
  proof: AlbemarleInlineIncomeProof
) {
  const expected = originalAlbemarleInlineIncome(p, proof),
    next = structuredClone(p);
  for (const [key, value] of Object.entries(expected.metrics)) {
    const k = key as keyof PeriodV2["metrics"];
    if (next.metrics[k] !== undefined)
      demand(
        next.metrics[k] === value,
        "Original quarterly source would replace a preserved amount."
      );
    else next.metrics[k] = value;
    if (!next.metricSources[k]) next.metricSources[k] = expected.metricSources[k];
  }
  next.grossOperatingItems = expected.ledger;
  next.operatingExpensesBasis = "expenses-and-other-items-net";
  const problem = albemarleInlineIncomeProblem(next);
  demand(!problem, problem ?? "Original quarterly proof failed.");
  return next;
}
