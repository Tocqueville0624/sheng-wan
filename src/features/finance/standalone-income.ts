import type { GrossOperatingItems } from "./types";
import type { PeriodV2 } from "./v2-types";
import {
  originalStandaloneBusinessSegments,
  originalStandaloneReportedMetrics,
  type OriginalStandaloneBusinessProof
} from "./standalone-business";
import { replayOriginalStandaloneSourceProof } from "./standalone-source-proof";

export const albOriginalIncomeRule = "alb-original-separate-income-v1";
const canonical = (x: unknown): string =>
  JSON.stringify(x, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
function demand(x: unknown, reason: string): asserts x {
  if (!x) throw Error(reason);
}

/** The complete original primary table corroborates each stage, including the
 * separate after-tax scopes. No inferred tax, residual expense or missing zero. */
export function originalAlbemarleIncome(
  p: PeriodV2,
  source: OriginalStandaloneBusinessProof
): GrossOperatingItems {
  demand(
    source.ruleId === "alb-original-separate-revenue-v1" && source.source.cik === "0000915913",
    "Unreviewed original income source."
  );
  const { joins } = replayOriginalStandaloneSourceProof(source.source);
  const primary = joins[0];
  const reported = originalStandaloneReportedMetrics(p, source.source.cik, primary);
  // Replay the full metadata, table layout, taxonomy and business-scope checks
  // against actual primary facts, independently of legacy Company Facts labels.
  originalStandaloneBusinessSegments({ ...p, ...reported }, source);
  const row = (index: number) => {
    const rows = primary.monetaryRows.filter((r) => r.rowIndex === index);
    demand(rows.length === 1, "Missing original income row.");
    const r = rows[0],
      f = r.originalFact;
    return {
      id: `alb-original-income-${index}`,
      label: r.label,
      tag: f.tag,
      amount: r.displayedWholeDollarValue,
      decimals: f.decimals,
      rowIndex: index
    };
  };
  const identity = (value: number, expected: number) =>
    demand(value === expected, "Original income scopes do not reconcile exactly.");
  const v = (index: number) => row(index).amount;
  identity(v(4) - v(5), v(6));
  identity(v(6) - v(7) - v(8) - v(9) - v(10), v(11));
  identity(v(11) + v(12) + v(13), v(14));
  identity(v(14) - v(15), v(16));
  identity(v(16) + v(17), v(18));
  identity(v(18) + v(19), v(20));
  identity(v(20) + v(21), v(22));
  return {
    ruleId: albOriginalIncomeRule,
    sourceUrl: p.sourceUrl,
    accession: p.accession!,
    filedAt: p.filedAt,
    startDate: p.startDate,
    endDate: p.endDate,
    currency: "USD",
    tableIndex: primary.tableIndex,
    revenue: row(4),
    cost: row(5),
    grossCosts: [],
    grossProfit: row(6),
    operatingCosts: [7, 8, 9, 10].map(row),
    operatingIncome: row(11),
    standaloneSource: source
  };
}

export function originalAlbemarleIncomeProblem(p: PeriodV2): string | undefined {
  try {
    const ledger = p.grossOperatingItems;
    demand(ledger?.standaloneSource, "Missing original income proof.");
    const expected = originalAlbemarleIncome(p, ledger.standaloneSource);
    demand(canonical(ledger) === canonical(expected), "Altered original income ledger.");
    const { joins } = replayOriginalStandaloneSourceProof(ledger.standaloneSource.source);
    const reported = originalStandaloneReportedMetrics(p, "0000915913", joins[0]);
    for (const [key, amount] of Object.entries(reported.metrics)) {
      const k = key as keyof PeriodV2["metrics"],
        s = p.metricSources[k],
        expectedSource = reported.metricSources[k]!;
      demand(
        p.metrics[k] === amount &&
          s?.method === expectedSource.method &&
          s.sourceUrl === p.sourceUrl &&
          s.accession === p.accession &&
          s.filedAt === p.filedAt,
        "Original income metrics or provenance were altered."
      );
      if (k === "operatingExpenses") {
        demand(
          s.decimals === undefined &&
            (canonical(s) === canonical(expectedSource) ||
              (s.label === "operatingExpenses" &&
                s.tag === "grossProfit - operatingIncome" &&
                canonical(s.inputs) === canonical([p.sourceUrl, p.sourceUrl]))),
          "Unreviewed calculated original net expense provenance."
        );
      } else
        demand(
          s.tag === expectedSource.tag &&
            (s.decimals === undefined || s.decimals === expectedSource.decimals),
          "Changed original metric concept or precision."
        );
    }
    demand(
      p.operatingExpensesBasis === "expenses-and-other-items-net" &&
        p.metrics.afterTaxSubsidiaryIncome === undefined &&
        p.metrics.afterTaxTransactionIncome === undefined &&
        !p.operatingExpenseDetails?.length &&
        !p.operatingItems &&
        !p.directNetItems &&
        !p.operatingNetItems &&
        !p.roundedOperatingExpenseComponents &&
        !p.operatingReconciliation &&
        !p.grossProfitAdjustments?.length &&
        !p.afterTaxReconciliation &&
        !p.afterTaxTransactionItems &&
        !p.consolidatedIncomeSubtotal,
      "Competing original income interpretation."
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid original income proof.";
  }
}

/** Add only previously absent original facts. Legacy numbers, source labels,
 * calendars and calculation provenance are retained without replacement. */
export function enrichOriginalAlbemarleIncome(
  p: PeriodV2,
  source: OriginalStandaloneBusinessProof
) {
  const ledger = originalAlbemarleIncome(p, source);
  const reported = originalStandaloneReportedMetrics(
    p,
    "0000915913",
    replayOriginalStandaloneSourceProof(source.source).joins[0]
  );
  const next = structuredClone(p);
  for (const [key, value] of Object.entries(reported.metrics)) {
    const k = key as keyof PeriodV2["metrics"];
    if (next.metrics[k] !== undefined)
      demand(next.metrics[k] === value, "Original income would replace a preserved amount.");
    else next.metrics[k] = value;
    if (!next.metricSources[k]) next.metricSources[k] = reported.metricSources[k];
  }
  next.grossOperatingItems = ledger;
  next.operatingExpensesBasis = "expenses-and-other-items-net";
  const problem = originalAlbemarleIncomeProblem(next);
  demand(!problem, problem ?? "Original income proof failed validation.");
  return next;
}
