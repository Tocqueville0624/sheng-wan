import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import type { OperatingItems, StatementLine } from "../../src/features/finance/types";
import {
  operatingCostInput,
  operatingItemMeaning,
  operatingItemRules,
  operatingItemsProblem
} from "../../src/features/finance/operating-items";
import { factKey, precise } from "./business-v2";
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
      p.metrics.operatingExpenses === undefined
  )) {
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        !f.context.typed &&
        f.currency === "USD" &&
        Number.isFinite(f.value)
    );
    const groups = new Map<string, XbrlFact[]>();
    for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
    for (const [tableIndex, table] of tables.entries()) {
      if (!/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)) continue;
      const rows = tableRows(table, refs);
      if (!rows) continue;
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
      const ledger = lines.slice(rIndex + 1, oIndex).map((l) => {
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
        items: ledger as OperatingItems["items"]
      };
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
          totalOperatingCosts: {
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
