import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import type { OperatingItems, StatementLine } from "../../src/features/finance/types";
import {
  operatingCostInput,
  operatingItemMeaning,
  operatingItemRules,
  operatingItemsProblem,
  operatingScope
} from "../../src/features/finance/operating-items";
import { attribute, factKey, precise } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { applyStatementReading, readStatementRows, tableRows } from "./statement-v2";

/** Reviewed source meanings are required when a primary operating ledger mixes
 * costs with gains. Never net a gain into costs or use an arithmetic residual.
 */
export function enrichOperatingPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsedInput?: ParsedFiling
): PeriodV2[] {
  const rule = operatingItemRules.find((r) => r.cik === identity.cik);
  if (!rule) return [];
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Operating ledger source does not match the SEC issuer and accession.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Operating ledger source CIK does not match the catalog.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(([table]) => table);
  if (tables.length > 2000) throw new Error("Operating ledger table count exceeds safe limits.");
  const result: PeriodV2[] = [];
  for (const period of existing.filter(
    (p) =>
      p.sourceUrl === filing.sourceUrl &&
      p.accession === filing.accession &&
      p.filedAt === filing.filedAt &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.operatingItems &&
      p.metrics.grossProfit === undefined &&
      (p.metrics.operatingExpenses === undefined ||
        (rule.id === "pld-operating-subtotals-v1" &&
          p.metrics.operatingExpenses < 0 &&
          p.metricSources.operatingExpenses?.method === "reported" &&
          p.metricSources.operatingExpenses.tag === "us-gaap:OperatingExpenses" &&
          p.metricSources.operatingExpenses.sourceUrl === filing.sourceUrl &&
          p.metricSources.operatingExpenses.accession === filing.accession &&
          p.metricSources.operatingExpenses.filedAt === filing.filedAt))
  )) {
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        !f.context.typed &&
        f.currency === "USD" &&
        Number.isFinite(f.value)
    );
    const linesInTable = (table: string) => {
      // Reviewed primary ledgers use only the table's own fact references. A
      // different statement can reuse a nondimensional QName with another scope.
      const references = new Set(
        [...table.matchAll(/<ix:nonFraction\b[^>]*>/gi)].map(
          ([opening]) => `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`
        )
      );
      const scoped =
        "costSubtotalTag" in rule
          ? facts.filter((f) => references.has(`${f.tag}|${f.context.id}`))
          : facts;
      const groups = new Map<string, XbrlFact[]>();
      for (const f of scoped) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
      const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
      const refs = new Map(scoped.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
      const rows = tableRows(table, refs);
      if (!rows) return;
      const lines = rows.map((row, rowIndex) => {
        const fact = row.facts.length === 1 ? row.facts[0] : undefined;
        if (!fact || !Number.isInteger(fact.decimals) || !row.label) return;
        return {
          id: `operating-${rowIndex}-${fact.tag.split(":").at(-1)}`,
          label: row.label,
          tag: fact.tag,
          amount: fact.value,
          decimals: fact.decimals,
          rowIndex,
          ...(Object.keys(fact.context.dimensions).length
            ? { dimensions: fact.context.dimensions }
            : {})
        };
      });
      return { rows, lines };
    };
    for (const [tableIndex, table] of tables.entries()) {
      if (!/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)) continue;
      const readingLines = linesInTable(table);
      if (!readingLines) continue;
      const { rows, lines } = readingLines;
      const anchors = (tag: string) =>
        lines.flatMap((l, i) => (l?.tag === tag && !l.dimensions ? [i] : []));
      const revenueRows = anchors(rule.revenueTag),
        operatingRows = anchors(rule.operatingTag);
      if (revenueRows.length !== 1 || operatingRows.length !== 1) continue;
      const rIndex = revenueRows[0]!,
        oIndex = operatingRows[0]!;
      if (oIndex <= rIndex + 1) continue;
      const revenue = lines[rIndex]!,
        operating = lines[oIndex]!;
      if (revenue.dimensions || operating.dimensions) continue;
      const checkpoint = (tag: string) => {
        const indexes = anchors(tag);
        return indexes.length === 1 && indexes[0]! > rIndex && indexes[0]! < oIndex
          ? lines[indexes[0]!]
          : undefined;
      };
      const costSubtotal = "costSubtotalTag" in rule ? checkpoint(rule.costSubtotalTag) : undefined;
      const operatingSubtotal =
        "operatingSubtotalTag" in rule ? checkpoint(rule.operatingSubtotalTag) : undefined;
      if (
        ("costSubtotalTag" in rule && !costSubtotal) ||
        ("operatingSubtotalTag" in rule && !operatingSubtotal)
      )
        continue;
      const ledger = lines
        .slice(rIndex + 1, oIndex)
        .filter((l) => l !== costSubtotal && l !== operatingSubtotal)
        .map((l) => {
          const effect = l && operatingItemMeaning(rule.id, l.tag, l.label, l.dimensions);
          return l && effect ? { ...l, effect } : undefined;
        });
      if (ledger.some((l) => !l)) continue;
      const proof: OperatingItems = {
        ruleId: rule.id,
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        filedAt: filing.filedAt,
        startDate: period.startDate,
        endDate: period.endDate,
        currency: "USD",
        tableIndex,
        revenue,
        operatingIncome: operating,
        ...(costSubtotal ? { costSubtotal } : {}),
        ...(operatingSubtotal ? { operatingSubtotal } : {}),
        items: ledger as OperatingItems["items"]
      };
      if (period.metrics.operatingExpenses !== undefined) {
        const candidates: NonNullable<OperatingItems["excludedSegmentExpenses"]>[] = [];
        for (const [index, other] of tables.entries()) {
          if (index === tableIndex || other.length > 512000 || /<table\b/i.test(other.slice(6)))
            continue;
          const read = linesInTable(other);
          if (!read) continue;
          const one = (tag: string, label: RegExp, dimensions: Record<string, string> = {}) => {
            const selected = read.lines.filter(
              (l) =>
                l?.tag === tag &&
                operatingScope(l.dimensions) === operatingScope(dimensions) &&
                label.test(l.label)
            );
            return selected.length === 1 ? selected[0] : undefined;
          };
          const r = one("us-gaap:Revenues", /^Total revenues$/i);
          const expense = one("us-gaap:OperatingExpenses", /^Total expenses$/i);
          const segment = one(
            "us-gaap:OperatingIncomeLoss",
            /^Total segment net operating income$/i,
            { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }
          );
          if (r && expense && segment && expense.amount === period.metrics.operatingExpenses) {
            candidates.push({
              tableIndex: index,
              revenue: r,
              totalExpenses: expense,
              segmentIncome: segment,
              originalMetricSource: period.metricSources.operatingExpenses!
            });
          }
        }
        if (candidates.length !== 1) continue;
        proof.excludedSegmentExpenses = candidates[0];
      }
      const costs = proof.items.filter((l) => l.effect === "cost");
      const costSum = costs.reduce((s, l) => s + l.amount, 0);
      if (
        (period.metrics.revenue !== undefined && period.metrics.revenue !== revenue.amount) ||
        (period.metrics.operatingIncome !== undefined &&
          period.metrics.operatingIncome !== operating.amount) ||
        (period.metrics.totalOperatingCosts !== undefined &&
          period.metrics.totalOperatingCosts !== costSum)
      )
        continue;
      const reported = (l: StatementLine): MetricSource => ({
        label: l.label,
        tag: l.tag!,
        accession: filing.accession,
        filedAt: filing.filedAt,
        sourceUrl: filing.sourceUrl,
        method: "reported",
        decimals: l.decimals
      });
      const drawn = costs
        .filter((l) => l.amount > 0)
        .map((l): StatementLine => ({
          id: l.id,
          label: l.label,
          tag: l.tag,
          amount: l.amount,
          decimals: l.decimals,
          ...(l.dimensions ? { dimensions: l.dimensions } : {})
        }));
      const next: PeriodV2 = {
        ...period,
        metrics: {
          ...period.metrics,
          revenue: revenue.amount,
          operatingIncome: operating.amount,
          totalOperatingCosts: costSum
        },
        metricSources: {
          ...period.metricSources,
          revenue: reported(revenue),
          operatingIncome: reported(operating),
          totalOperatingCosts: costSubtotal
            ? reported(costSubtotal)
            : {
                label: "Sum of reported operating cost lines",
                tag: costs.map((l) => l.tag).join(" + "),
                sourceUrl: filing.sourceUrl,
                accession: filing.accession,
                filedAt: filing.filedAt,
                method: "calculated",
                inputs: costs.map((l) => operatingCostInput(l, filing.sourceUrl))
              }
        },
        operatingItems: proof,
        operatingCostDetails: drawn.length >= 2 ? drawn : undefined
      };
      if (proof.excludedSegmentExpenses) {
        delete next.metrics.operatingExpenses;
        delete next.metricSources.operatingExpenses;
      }
      if (operatingItemsProblem(next)) continue;
      const reading = readStatementRows(rows, next, filing);
      const complete = reading && applyStatementReading(next, reading);
      if (!complete) continue;
      result.push(complete);
      break;
    }
  }
  return result;
}
