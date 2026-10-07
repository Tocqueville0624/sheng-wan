import type { GrossOperatingItems, ServiceRevenueRow, ServiceRevenueRowsProof } from "./types";
import type { PeriodV2 } from "./v2-types";
import { originalThousandDollarRows } from "./original-revenue-rows";

export const alignInlineIncomeRule = "align-original-inline-after-tax-equity-v1";
export type AlignInlineIncomeProof = {
  ruleId: typeof alignInlineIncomeRule;
  form: string;
  reportDate: string;
  originalFiscalYear: number;
  tableIndex: number;
  precedingText: string;
  units: ServiceRevenueRowsProof["units"];
  rows: ServiceRevenueRow[];
};
const demand = (condition: unknown, reason: string) => {
  if (!condition) throw Error(reason);
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const meanings: Record<number, [string, string, "same" | "opposite"]> = {
  3: ["Net revenues", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "same"],
  4: ["Cost of net revenues", "us-gaap:CostOfRevenue", "same"],
  5: ["Gross profit", "us-gaap:GrossProfit", "same"],
  7: [
    "Selling, general and administrative",
    "us-gaap:SellingGeneralAndAdministrativeExpense",
    "same"
  ],
  9: ["Research and development", "us-gaap:ResearchAndDevelopmentExpense", "same"],
  11: [
    "Impairments and other charges (gains), net",
    "us-gaap:GainLossOnSalesOfAssetsAndAssetImpairmentCharges",
    "opposite"
  ],
  12: ["Litigation settlement gain", "us-gaap:GainLossRelatedToLitigationSettlement", "opposite"],
  13: ["Total operating expenses", "us-gaap:OperatingExpenses", "same"],
  14: ["Income from operations", "us-gaap:OperatingIncomeLoss", "same"],
  16: ["Interest income", "us-gaap:InterestIncomeOther", "same"],
  17: ["Other income (expense), net", "us-gaap:NonoperatingIncomeExpense", "same"],
  18: [
    "Total interest income and other income (expense), net",
    "algn:InterestIncomeAndOtherIncomeExpenseNet",
    "same"
  ],
  19: [
    "Net income before provision for (benefit from) income taxes and equity in losses of investee",
    "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "same"
  ],
  20: ["Provision for (benefit from) income taxes", "us-gaap:IncomeTaxExpenseBenefit", "same"],
  21: [
    "Equity in losses of investee, net of tax",
    "us-gaap:IncomeLossFromEquityMethodInvestments",
    "opposite"
  ],
  22: ["Net income", "us-gaap:NetIncomeLoss", "same"]
};
const metricRows = {
  revenue: 3,
  costOfRevenue: 4,
  grossProfit: 5,
  sellingGeneralAndAdministrative: 7,
  researchAndDevelopment: 9,
  operatingExpenses: 13,
  operatingIncome: 14,
  pretaxIncome: 19,
  incomeTax: 20,
  equityMethodIncome: 21,
  netIncome: 22
} as const;
/** This finite original source proves every comparative primary column, including
 * reported operating gains and signed after-tax equity losses. It supplements
 * absent facts only and never substitutes a different preserved concept. */
export function originalAlignInlineIncome(p: PeriodV2, proof: AlignInlineIncomeProof) {
  const url = new URL(p.sourceUrl);
  demand(
    p.accession === "0001097149-22-000011" &&
      p.filedAt === "2022-02-25" &&
      url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/Archives/edgar/data/1097149/000109714922000011/algn-20211231.htm" &&
      p.kind === "annual" &&
      [2019, 2020, 2021].includes(p.fiscalYear) &&
      p.startDate === `${p.fiscalYear}-01-01` &&
      p.endDate === `${p.fiscalYear}-12-31` &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      proof.ruleId === alignInlineIncomeRule &&
      proof.form === "10-K" &&
      proof.reportDate === "2021-12-31" &&
      proof.originalFiscalYear === 2021 &&
      Number.isInteger(proof.tableIndex) &&
      proof.tableIndex >= 0 &&
      proof.tableIndex < 5000 &&
      typeof proof.precedingText === "string" &&
      proof.precedingText.length <= 16000 &&
      proof.precedingText.endsWith(
        "ALIGN TECHNOLOGY, INC. AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF OPERATIONS (in thousands, except per share data)"
      ),
    "Changed original Align inline income source or period."
  );
  demand(
    proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Invalid original Align units."
  );
  demand(
    proof.rows.length === 23 && proof.rows.every((r, i) => r.rowIndex === i),
    "Missing original Align income rows."
  );
  originalThousandDollarRows(proof.rows, proof.units, "0001097149");
  const labels = (i: number) =>
    proof.rows[i].cells.filter((c) => c.label).map((c) => [c.columnIndex, c.span, c.label]);
  demand(
    JSON.stringify(labels(1)) === JSON.stringify([[6, 15, "Year Ended December 31,"]]) &&
      JSON.stringify(labels(2)) ===
        JSON.stringify([
          [6, 3, "2021"],
          [12, 3, "2020"],
          [18, 3, "2019"]
        ]) &&
      proof.rows[1].cells.every((c) => !c.fact) &&
      proof.rows[2].cells.every((c) => !c.fact),
    "Changed original Align comparative headers."
  );
  for (const i of [0, 8, 10])
    demand(
      proof.rows[i].cells.every((c) => !c.fact && !c.label),
      "Changed original Align blank row."
    );
  for (const [i, label] of [
    [6, "Operating expenses:"],
    [15, "Interest income and other income (expense), net:"]
  ] as const)
    demand(
      proof.rows[i].cells[0].label === label &&
        proof.rows[i].cells.slice(1).every((c) => !c.fact && !c.label),
      "Changed original Align primary section."
    );
  const columns = [2021, 2020, 2019].map((year, index) => {
    const start = `${year}-01-01`,
      end = `${year}-12-31`,
      column = 6 + index * 6;
    const lines = Object.fromEntries(
      Object.entries(meanings).map(([n, [label, tag, polarity]]) => {
        const r = proof.rows[Number(n)],
          selected = r.cells.filter((c) => c.fact?.startDate === start && c.fact.endDate === end);
        demand(
          r.cells[0].label === label &&
            !r.cells[0].fact &&
            r.cells.filter((c) => c.fact).length === 3 &&
            selected.length === 1,
          "Changed or incomplete original Align monetary row."
        );
        const c = selected[0],
          f = c.fact!;
        demand(
          f.tag === tag &&
            !Object.keys(f.dimensions).length &&
            c.columnIndex >= column &&
            c.columnIndex + c.span <= column + 3 &&
            r.cells.slice(1).every((x) => x.fact || /^(?:\$|[—–-])?$/.test(x.label)),
          "Foreign or unaccounted original Align income cell."
        );
        const negative = /^\(.*\)$/.test(c.label.trim());
        demand(
          f.value === 0
            ? /^[—–-]$/.test(c.label.trim())
            : negative === (polarity === "same" ? f.value < 0 : f.value > 0),
          "Changed displayed Align gain or deduction sign."
        );
        return [n, f];
      })
    );
    const v = (i: number) => lines[i].value;
    demand(
      v(3) > 0 && [4, 7, 9, 13, 16].every((i) => v(i) >= 0) && v(21) <= 0,
      "Unreviewed original Align costs or equity scope."
    );
    demand(
      v(3) - v(4) === v(5) &&
        v(7) + v(9) - v(11) - v(12) === v(13) &&
        v(5) - v(13) === v(14) &&
        v(16) + v(17) === v(18) &&
        v(14) + v(18) === v(19) &&
        v(19) - v(20) + v(21) === v(22),
      "Original Align primary income identities do not reconcile."
    );
    return { year, lines };
  });
  const selected = columns.find((c) => c.year === p.fiscalYear)!;
  const metrics = Object.fromEntries(
    Object.entries(metricRows).map(([k, i]) => [k, selected.lines[i].value])
  ) as PeriodV2["metrics"];
  const metricSources = Object.fromEntries(
    Object.entries(metricRows).map(([k, i]) => [
      k,
      {
        label: meanings[i][0],
        tag: selected.lines[i].tag,
        sourceUrl: p.sourceUrl,
        accession: p.accession!,
        filedAt: p.filedAt,
        method: "reported",
        decimals: selected.lines[i].decimals
      }
    ])
  ) as PeriodV2["metricSources"];
  const line = (i: number) => ({
    id: `align-original-income-${i}`,
    label: meanings[i][0],
    tag: selected.lines[i].tag,
    amount: selected.lines[i].value,
    decimals: selected.lines[i].decimals,
    rowIndex: i
  });
  const ledger: GrossOperatingItems = {
    ruleId: alignInlineIncomeRule,
    sourceUrl: p.sourceUrl,
    accession: p.accession!,
    filedAt: p.filedAt,
    startDate: p.startDate,
    endDate: p.endDate,
    currency: "USD",
    tableIndex: proof.tableIndex,
    revenue: line(3),
    cost: line(4),
    grossCosts: [],
    grossProfit: line(5),
    operatingCosts: [
      line(7),
      line(9),
      { ...line(11), amount: -line(11).amount },
      { ...line(12), amount: -line(12).amount }
    ],
    operatingIncome: line(14)
  };
  return { metrics, metricSources, ledger };
}
export function alignInlineIncomeProblem(p: PeriodV2) {
  if (!p.alignInlineIncome)
    return p.grossOperatingItems?.ruleId === alignInlineIncomeRule
      ? "Missing original Align income proof."
      : undefined;
  try {
    const original = originalAlignInlineIncome(p, p.alignInlineIncome);
    demand(
      canonical(p.grossOperatingItems) === canonical(original.ledger),
      "Changed original Align operating gains or expenses."
    );
    demand(
      !p.operatingItems &&
        !p.operatingNetItems &&
        !p.directNetItems &&
        !p.operatingExpenseDetails?.length &&
        !p.operatingCostDetails?.length &&
        !p.operatingExpensesBasis &&
        !p.roundedOperatingExpenseComponents &&
        !p.grossProfitAdjustments?.length &&
        !p.operatingReconciliation &&
        !p.afterTaxReconciliation,
      "Competing original Align operating interpretation."
    );
    for (const [key, value] of Object.entries(original.metrics)) {
      const k = key as keyof PeriodV2["metrics"],
        s = p.metricSources[k];
      demand(
        p.metrics[k] === value &&
          s?.method === "reported" &&
          s.sourceUrl === p.sourceUrl &&
          s.accession === p.accession &&
          s.filedAt === p.filedAt,
        "Original Align primary fact differs from preserved metric."
      );
    }
    demand(
      canonical(p.metricSources.equityMethodIncome) ===
        canonical(original.metricSources.equityMethodIncome),
      "Changed original after-tax equity attribution."
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Align income proof";
  }
}
export function enrichOriginalAlignInlineIncome(
  p: PeriodV2,
  proof: AlignInlineIncomeProof
): PeriodV2 {
  const original = originalAlignInlineIncome(p, proof),
    next = {
      ...p,
      metrics: { ...p.metrics },
      metricSources: { ...p.metricSources },
      alignInlineIncome: proof,
      grossOperatingItems: original.ledger
    };
  for (const key of Object.keys(original.metrics) as (keyof PeriodV2["metrics"])[]) {
    if (next.metrics[key] === undefined) {
      next.metrics[key] = original.metrics[key];
      next.metricSources[key] = original.metricSources[key];
    }
  }
  const error = alignInlineIncomeProblem(next);
  if (error) throw Error(error);
  return next;
}
