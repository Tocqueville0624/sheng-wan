import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import type { GrossOperatingItems } from "../../src/features/finance/types";
import {
  flexGrossOperatingRule,
  flexOperatingCostMeaning,
  grossOperatingExpenseSum,
  grossOperatingInput,
  grossOperatingItemsProblem
} from "../../src/features/finance/gross-operating-items";
import { factKey, precise } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { applyStatementReading, readStatementRows, tableRows } from "./statement-v2";

/** Separate cost-of-sales restructuring and signed operating costs, only under
 * this issuer's reviewed primary source layout. No amount/date aliases. */
export function enrichGrossOperatingPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  input?: ParsedFiling
): PeriodV2[] {
  const rule = flexGrossOperatingRule;
  if (identity.cik !== rule.cik) return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(rule.cik)}/${filing.accession.replaceAll("-", "")}/`
    )
  )
    throw new Error("Gross/operating source does not match the SEC issuer and accession.");
  const parsed = input ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(rule.cik)))
    throw new Error("Gross/operating source CIK does not match the catalog.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(([t]) => t);
  if (tables.length > 2000) throw new Error("Gross/operating table count exceeds safe limits.");
  // A QName/context reference may also occur in a more precise narrative fact.
  // Parse actual table cells with the original context/unit resources, so the
  // narrative cannot supply an amount or precision to the primary statement.
  const resources = [
    ...html.matchAll(/<((?:[\w.-]+:)?(?:context|unit))\b[^>]*>[\s\S]*?<\/\1\s*>/gi)
  ]
    .map(([resource]) => resource)
    .join("\n");
  const tableFacts = new Map<number, XbrlFact[]>();
  const result: PeriodV2[] = [];
  for (const period of existing.filter(
    (p) =>
      p.sourceUrl === filing.sourceUrl &&
      p.accession === filing.accession &&
      p.filedAt === filing.filedAt &&
      p.displayCurrency === "USD" &&
      p.reportingCurrency === "USD"
  )) {
    for (const [tableIndex, table] of tables.entries()) {
      if (!/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)) continue;
      if (!tableFacts.has(tableIndex))
        tableFacts.set(tableIndex, parseInlineXbrl(resources + table).facts);
      const scoped = tableFacts
        .get(tableIndex)!
        .filter(
          (f) =>
            f.context.start === period.startDate &&
            f.context.end === period.endDate &&
            f.currency === "USD" &&
            Number.isFinite(f.value)
        );
      const groups = new Map<string, XbrlFact[]>();
      for (const f of scoped) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
      const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
      const refs = new Map(scoped.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
      const rows = tableRows(table, refs);
      if (!rows) continue;
      const lines = rows.map((r, rowIndex): GrossOperatingItems["cost"] | undefined => {
        const f = r.facts.length === 1 ? r.facts[0] : undefined;
        if (
          !f ||
          !r.label ||
          f.context.typed ||
          Object.keys(f.context.dimensions).length ||
          !Number.isInteger(f.decimals)
        )
          return;
        return {
          id: `gross-operating-${rowIndex}-${f.tag.split(":").at(-1)}`,
          label: r.label,
          tag: f.tag,
          amount: f.value,
          decimals: f.decimals,
          rowIndex
        };
      });
      const anchor = (tag: string) => {
        const indexes = lines.flatMap((l, i) => (l?.tag === tag ? [i] : []));
        return indexes.length === 1 ? indexes[0]! : -1;
      };
      const r = anchor(rule.revenue),
        g = anchor(rule.grossProfit),
        o = anchor(rule.operatingIncome);
      if (r < 0 || g !== r + 3 || o < g + 3 || o > g + 4) continue;
      const ledger = lines.slice(r, o + 1);
      if (ledger.some((l) => !l)) continue;
      const proof: GrossOperatingItems = {
        ruleId: rule.id,
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        filedAt: filing.filedAt,
        startDate: period.startDate,
        endDate: period.endDate,
        currency: "USD",
        tableIndex,
        revenue: lines[r]!,
        cost: lines[r + 1]!,
        grossCosts: [lines[r + 2]!],
        grossProfit: lines[g]!,
        operatingCosts: lines.slice(g + 1, o) as GrossOperatingItems["operatingCosts"],
        operatingIncome: lines[o]!
      };
      if (proof.operatingCosts.some((l) => !flexOperatingCostMeaning(l))) continue;
      const reported = (l: GrossOperatingItems["cost"]): MetricSource => ({
        label: l.label,
        tag: l.tag!,
        accession: filing.accession,
        filedAt: filing.filedAt,
        sourceUrl: filing.sourceUrl,
        method: "reported",
        decimals: l.decimals
      });
      const anchors = [
        ["revenue", proof.revenue],
        ["costOfRevenue", proof.cost],
        ["grossProfit", proof.grossProfit],
        ["operatingIncome", proof.operatingIncome],
        [
          "sellingGeneralAndAdministrative",
          proof.operatingCosts.find(
            (l) => l.tag === "us-gaap:SellingGeneralAndAdministrativeExpense"
          )!
        ]
      ] as const;
      if (
        anchors.some(
          ([key, l]) =>
            !l || (period.metrics[key] !== undefined && period.metrics[key] !== l.amount)
        )
      )
        continue;
      const net = grossOperatingExpenseSum(proof);
      if (
        period.metrics.operatingExpenses !== undefined &&
        period.metrics.operatingExpenses !== net &&
        !(period.grossOperatingItems && !grossOperatingItemsProblem(period))
      )
        continue;
      const next = structuredClone(period);
      next.grossOperatingItems = proof;
      for (const [key, l] of anchors) {
        next.metrics[key] = l.amount;
        next.metricSources[key] = reported(l);
      }
      next.metrics.operatingExpenses = net;
      next.metricSources.operatingExpenses = {
        label: "Sum of reported operating expense lines (net)",
        tag: proof.operatingCosts.map((l) => l.tag).join(" + "),
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        filedAt: filing.filedAt,
        method: "calculated",
        inputs: proof.operatingCosts.map((l) => grossOperatingInput(l, filing.sourceUrl))
      };
      next.grossProfitAdjustments = proof.grossCosts.map((l) => ({
        label: l.label,
        amount: -l.amount,
        sourceUrl: filing.sourceUrl
      }));
      next.operatingExpensesBasis = "expenses-and-other-items-net";
      // Re-read a previous calculated ledger from the actual same-filing cells.
      // A newly exact primary sum must not retain an older rounding difference.
      delete next.operatingReconciliation;
      const difference = proof.operatingIncome.amount - (proof.grossProfit.amount - net);
      if (Math.abs(difference) > Math.max(1e-6, proof.revenue.amount * 1e-9))
        next.operatingReconciliation = {
          label: "Source rounding",
          amount: difference,
          sourceUrl: filing.sourceUrl,
          basis: "gross-profit"
        };
      if (grossOperatingItemsProblem(next)) continue;
      const reading = readStatementRows(rows, next, filing, tableIndex);
      const complete = reading && applyStatementReading(next, reading);
      if (complete) {
        result.push(complete);
        break;
      }
    }
  }
  return result;
}
