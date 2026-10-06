import type { CatalogCompany, MetricSource, PeriodV2 } from "../../src/features/finance/v2-types";
import type { OperatingNetItems, ShareholderIncomeBridge } from "../../src/features/finance/types";
import {
  operatingNetAllocationMeaning,
  operatingNetItemsProblem,
  operatingNetMeaning,
  operatingNetRule
} from "../../src/features/finance/operating-net-items";
import { commonIncomeTag } from "../../src/features/finance/shareholder-bridge";
import { factKey, precise } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { tableRows } from "./statement-v2";
import { flowPeriod } from "./v2-model";

/** DLR's primary operating-to-net statement. No net-plus-tax pretax is inferred. */
export function enrichOperatingNetPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  input?: ParsedFiling
) {
  if (identity.cik !== operatingNetRule.cik) return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    )
  )
    throw new Error("Operating-to-net source does not match SEC identity.");
  const parsed = input ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Operating-to-net source has a different issuer.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(([t]) => t);
  if (tables.length > 2000) throw new Error("Operating-to-net table count exceeds safe limits.");
  const resources = [
    ...html.matchAll(/<((?:[\w.-]+:)?(?:context|unit))\b[^>]*>[\s\S]*?<\/\1\s*>/gi)
  ]
    .map(([r]) => r)
    .join("\n");
  const ownFacts = new Map<number, XbrlFact[]>();
  const output: PeriodV2[] = [];
  for (const period of periods.filter(
    (p) =>
      p.accession === filing.accession &&
      p.filedAt === filing.filedAt &&
      p.sourceUrl === filing.sourceUrl &&
      p.displayCurrency === "USD" &&
      p.reportingCurrency === "USD"
  )) {
    for (const [tableIndex, table] of tables.entries()) {
      if (!table.includes("us-gaap:ProfitLoss") || !table.includes("us-gaap:OperatingIncomeLoss"))
        continue;
      if (!ownFacts.has(tableIndex))
        ownFacts.set(tableIndex, parseInlineXbrl(resources + table).facts);
      const facts = ownFacts
        .get(tableIndex)!
        .filter(
          (f) =>
            f.context.start === period.startDate &&
            f.context.end === period.endDate &&
            !f.context.typed &&
            f.currency === "USD" &&
            Number.isFinite(f.value)
        );
      const groups = new Map<string, XbrlFact[]>();
      for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
      const best = new Map([...groups].map(([k, v]) => [k, precise(v)]));
      const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
      const rows = tableRows(table, refs);
      if (!rows) continue;
      const lines = rows.map((row, rowIndex): OperatingNetItems["revenue"] | undefined => {
        const f = row.facts.length === 1 ? row.facts[0] : undefined;
        if (
          !f ||
          !row.label ||
          Object.keys(f.context.dimensions).length ||
          !Number.isInteger(f.decimals)
        )
          return;
        return {
          id: `operating-net-${rowIndex}-${f.tag.split(":").at(-1)}`,
          label: row.label,
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
      const r = anchor("us-gaap:Revenues"),
        e = anchor("us-gaap:OperatingExpenses"),
        o = anchor("us-gaap:OperatingIncomeLoss"),
        c = anchor("us-gaap:ProfitLoss"),
        n = anchor("us-gaap:NetIncomeLossAttributableToNoncontrollingInterest"),
        p = anchor("us-gaap:NetIncomeLoss");
      if (
        r < 0 ||
        e <= r + 1 ||
        o <= e ||
        c <= o ||
        n !== c + 1 ||
        p !== c + 2 ||
        lines.slice(r, p + 1).some((l) => !l)
      )
        continue;
      const between = lines.slice(e + 1, o) as OperatingNetItems["operatingGains"];
      const netItems = lines
        .slice(o + 1, c)
        .map((l) => l && { ...l, effect: operatingNetMeaning(l) });
      if (netItems.some((l) => !l || !l.effect)) continue;
      const proof: OperatingNetItems = {
        ruleId: operatingNetRule.id,
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        filedAt: filing.filedAt,
        startDate: period.startDate,
        endDate: period.endDate,
        currency: "USD",
        tableIndex,
        revenue: lines[r]!,
        costs: lines.slice(r + 1, e) as OperatingNetItems["costs"],
        expenses: lines[e]!,
        ...(between.length ? { operatingSubtotal: between[0] } : {}),
        operatingGains: between.slice(1),
        operatingIncome: lines[o]!,
        netItems: netItems as OperatingNetItems["netItems"],
        consolidated: lines[c]!,
        noncontrolling: lines[n]!,
        parent: lines[p]!
      };
      const tax = proof.netItems.find((l) => l.tag === "us-gaap:IncomeTaxExpenseBenefit");
      if (!tax) continue;
      const reported = (l: OperatingNetItems["revenue"]): MetricSource => ({
        label: l.label,
        tag: l.tag!,
        accession: filing.accession,
        filedAt: filing.filedAt,
        sourceUrl: filing.sourceUrl,
        method: "reported",
        decimals: l.decimals
      });
      const next = structuredClone(period);
      // Reclassify this exact primary operating-expense subtotal as total costs;
      // it is not an expense subtotal after an unreported gross-profit stage.
      if (next.metrics.operatingExpenses !== undefined) {
        const s = next.metricSources.operatingExpenses;
        if (
          next.metrics.operatingExpenses !== proof.expenses.amount ||
          s?.method !== "reported" ||
          s.tag !== proof.expenses.tag ||
          s.sourceUrl !== filing.sourceUrl ||
          s.accession !== filing.accession ||
          s.filedAt !== filing.filedAt
        )
          continue;
        delete next.metrics.operatingExpenses;
        delete next.metricSources.operatingExpenses;
      }
      const anchors = [
        ["revenue", proof.revenue],
        ["totalOperatingCosts", proof.expenses],
        ["operatingIncome", proof.operatingIncome],
        ["incomeTax", tax],
        ["netIncome", proof.parent],
        ["noncontrollingInterestIncome", proof.noncontrolling]
      ] as const;
      if (
        anchors.some(
          ([key, l]) => next.metrics[key] !== undefined && next.metrics[key] !== l.amount
        )
      )
        continue;
      for (const [key, l] of anchors) {
        next.metrics[key] = l.amount;
        next.metricSources[key] = reported(l);
      }
      next.operatingNetItems = proof;
      const allocations: ShareholderIncomeBridge["allocations"] = [];
      let completeOwnership = false;
      for (let i = p + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l) break;
        if (l.tag === commonIncomeTag) {
          if (!allocations.length) break;
          next.shareholderBridge = {
            sourceUrl: filing.sourceUrl,
            accession: filing.accession,
            filedAt: filing.filedAt,
            base: {
              label: proof.parent.label,
              tag: proof.parent.tag!,
              amount: proof.parent.amount,
              decimals: proof.parent.decimals,
              scope: "parent"
            },
            common: { label: l.label, tag: l.tag, amount: l.amount, decimals: l.decimals },
            allocations
          };
          completeOwnership = true;
          break;
        }
        const meaning = operatingNetAllocationMeaning(l.tag!, l.label);
        if (!meaning) break;
        allocations.push({
          id: l.id,
          label: l.label,
          tag: l.tag!,
          amount: l.amount,
          decimals: l.decimals,
          ...(meaning === "gain" ? { effect: "gain" as const } : {})
        });
      }
      if (!completeOwnership || operatingNetItemsProblem(next) || !flowPeriod(next)) continue;
      next.derived = Object.values(next.metricSources).some((s) => s.method === "calculated");
      next.coverage = { ...next.coverage, sankey: true };
      output.push(next);
      break;
    }
  }
  return output;
}
