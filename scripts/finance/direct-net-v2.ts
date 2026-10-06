import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import type {
  DirectNetItems,
  ShareholderIncomeBridge,
  StatementLine
} from "../../src/features/finance/types";
import {
  directNetItemsProblem,
  directNetMeaning,
  directNetAllocationTags,
  directNetRule
} from "../../src/features/finance/direct-net-items";
import {
  commonIncomeTag,
  dilutedIncomeTag,
  shareholderAllocationTags
} from "../../src/features/finance/shareholder-bridge";
import { factKey, precise } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { tableRows } from "./statement-v2";
import { flowPeriod } from "./v2-model";

/** Source-specific direct net-income statements. Missing subtotals remain absent;
 * all expense rows and subsequent gains must be understood and reconcile exactly.
 */
export function enrichDirectNetPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsedInput?: ParsedFiling
) {
  if (identity.cik !== directNetRule.cik) return [];
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Direct net-income source does not match the SEC issuer and accession.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Direct net-income source has a different issuer.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(([table]) => table);
  if (tables.length > 2000) throw new Error("Direct net-income table count exceeds safe limits.");
  const output: PeriodV2[] = [];
  for (const period of periods.filter(
    (p) =>
      !p.directNetItems &&
      p.accession === filing.accession &&
      p.filedAt === filing.filedAt &&
      p.sourceUrl === filing.sourceUrl &&
      p.displayCurrency === "USD" &&
      p.reportingCurrency === "USD"
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
      if (!table.includes("us-gaap:ProfitLoss")) continue;
      const rows = tableRows(table, refs);
      if (!rows) continue;
      // A property-sale gain explicitly reported net of its own tax is not a
      // separate statement-wide income-tax stage. Inspect complete QNames,
      // rather than rejecting any concept containing the text "IncomeTax".
      if (
        rows.some((row) =>
          row.facts.some(
            (f) =>
              f &&
              [
                "us-gaap:IncomeTaxExpenseBenefit",
                "us-gaap:OperatingIncomeLoss",
                "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
              ].includes(f.tag)
          )
        )
      )
        continue;
      const lines = rows.map((row, rowIndex) => {
        const f = row.facts.length === 1 ? row.facts[0] : undefined;
        if (
          !f ||
          Object.keys(f.context.dimensions).length ||
          !Number.isInteger(f.decimals) ||
          !row.label
        )
          return;
        return {
          id: `direct-net-${rowIndex}-${f.tag.split(":").at(-1)}`,
          label: row.label,
          tag: f.tag,
          amount: f.value,
          decimals: f.decimals,
          rowIndex
        };
      });
      const anchor = (tag: string) => {
        const matches = lines.flatMap((l, i) => (l?.tag === tag ? [i] : []));
        return matches.length === 1 ? matches[0] : undefined;
      };
      const r = anchor(directNetRule.revenueTag),
        e = anchor("us-gaap:CostsAndExpenses"),
        c = anchor("us-gaap:ProfitLoss"),
        n = anchor("us-gaap:NetIncomeLossAttributableToNoncontrollingInterest"),
        p = anchor("us-gaap:NetIncomeLoss");
      if (
        r === undefined ||
        e === undefined ||
        c === undefined ||
        n !== c + 1 ||
        p !== c + 2 ||
        e <= r + 1 ||
        c <= e + 1
      )
        continue;
      const expenses = lines.slice(r + 1, e).map((l) => {
        const effect = l && directNetMeaning(l.tag, l.label, true);
        return l && effect ? { ...l, effect } : undefined;
      });
      const gains = lines.slice(e + 1, c);
      if (
        expenses.some((l) => !l) ||
        gains.some((l) => !l || directNetMeaning(l.tag, l.label, false) !== "gain")
      )
        continue;
      const proof: DirectNetItems = {
        ruleId: directNetRule.id,
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        filedAt: filing.filedAt,
        startDate: period.startDate,
        endDate: period.endDate,
        currency: "USD",
        tableIndex,
        revenue: lines[r]!,
        expenses: lines[e]!,
        expenseItems: expenses as DirectNetItems["expenseItems"],
        gains: gains as DirectNetItems["gains"],
        consolidated: lines[c]!,
        noncontrolling: lines[n]!,
        parent: lines[p]!
      };
      const reported = (l: StatementLine): MetricSource => ({
        label: l.label,
        tag: l.tag!,
        accession: filing.accession,
        filedAt: filing.filedAt,
        sourceUrl: filing.sourceUrl,
        method: "reported",
        decimals: l.decimals
      });
      const metrics = { ...period.metrics },
        metricSources = { ...period.metricSources };
      // Company Facts uses this broad standard tag as a basic cost candidate.
      // Under this reviewed statement it includes interest, so retain its exact
      // amount as total expenses instead of claiming it is an operating subtotal.
      if (metrics.totalOperatingCosts !== undefined) {
        const s = metricSources.totalOperatingCosts;
        if (
          metrics.totalOperatingCosts !== proof.expenses.amount ||
          !s ||
          s?.tag !== proof.expenses.tag ||
          s.method !== "reported" ||
          s.sourceUrl !== filing.sourceUrl ||
          s.accession !== filing.accession ||
          s.filedAt !== filing.filedAt
        )
          continue;
        delete metrics.totalOperatingCosts;
        delete metricSources.totalOperatingCosts;
      }
      let conflict = false;
      for (const [key, line] of [
        ["revenue", proof.revenue],
        ["totalExpenses", proof.expenses],
        ["netIncome", proof.parent],
        ["noncontrollingInterestIncome", proof.noncontrolling]
      ] as const) {
        if (metrics[key] !== undefined && metrics[key] !== line.amount) conflict = true;
        metrics[key] = line.amount;
        metricSources[key] = reported(line);
      }
      if (conflict) continue;
      const next: PeriodV2 = {
        ...period,
        metrics,
        metricSources,
        directNetItems: proof,
        derived: Object.values(metricSources).some((s) => s.method === "calculated")
      };
      if (directNetItemsProblem(next)) continue;
      const allocations: ShareholderIncomeBridge["allocations"] = [];
      let running = proof.parent.amount;
      for (let i = p + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l) break;
        if (l.tag === commonIncomeTag || l.tag === dilutedIncomeTag) {
          if (
            allocations.length &&
            Math.abs(running - l.amount) <= Math.max(1e-6, proof.revenue.amount * 1e-9)
          )
            next.shareholderBridge = {
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              filedAt: filing.filedAt,
              base: {
                label: proof.parent.label,
                tag: proof.parent.tag!,
                amount: proof.parent.amount,
                scope: "parent",
                decimals: proof.parent.decimals
              },
              common: { label: l.label, tag: l.tag, amount: l.amount, decimals: l.decimals },
              allocations
            };
          break;
        }
        if (!shareholderAllocationTags.has(l.tag) && !directNetAllocationTags.has(l.tag)) break;
        allocations.push({
          id: `shareholder-${i}-${l.tag.split(":").at(-1)}`,
          label: l.label,
          tag: l.tag,
          amount: l.amount,
          decimals: l.decimals
        });
        running -= l.amount;
      }
      if (!flowPeriod(next)) continue;
      next.coverage = { ...next.coverage, sankey: true };
      output.push(next);
      break;
    }
  }
  return output;
}
