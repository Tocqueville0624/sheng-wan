import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { ShareholderIncomeBridge } from "../../src/features/finance/types";
import {
  commonIncomeTag,
  consolidatedIncomeTags,
  dilutedIncomeTag,
  minorityIncomeTag,
  parentIncomeTags,
  shareholderAllocationTags,
  shareholderBridgeProblem
} from "../../src/features/finance/shareholder-bridge";
import { factKey, precise } from "./business-v2";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import { tableRows } from "./statement-v2";
import { flowPeriod } from "./v2-model";
import type { SecFiling } from "./sec-shared";

/** Preserve source-ordered ownership allocations separately from operating
 * expenses and the selected parent/consolidated income metric.
 */
export function enrichShareholderPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsedInput?: ParsedFiling
) {
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Shareholder source does not match SEC identity.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Shareholder source has a different issuer.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)]
    .map(([t]) => t)
    .filter((t) => t.includes(commonIncomeTag) && /<ix:nonFraction\b[^>]*IncomeTax/i.test(t));
  if (tables.length > 2000) throw new Error("Shareholder table count exceeds safe limits.");
  const output: PeriodV2[] = [];
  for (const period of periods) {
    const netSource = period.metricSources.netIncome;
    const scope = parentIncomeTags.has(netSource?.tag ?? "")
      ? "parent"
      : consolidatedIncomeTags.has(netSource?.tag ?? "")
        ? "consolidated"
        : undefined;
    if (
      !scope ||
      period.shareholderBridge ||
      period.accession !== filing.accession ||
      period.filedAt !== filing.filedAt ||
      period.sourceUrl !== filing.sourceUrl ||
      period.displayCurrency !== "USD" ||
      period.reportingCurrency !== "USD" ||
      netSource?.method !== "reported"
    )
      continue;
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        !f.context.typed &&
        f.currency === "USD" &&
        Number.isFinite(f.value)
    );
    const groups = new Map<string, XbrlFact[]>();
    for (const fact of facts)
      groups.set(factKey(fact), [...(groups.get(factKey(fact)) ?? []), fact]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
    const consolidated = new Map(
      [...best.values()]
        .filter((f): f is XbrlFact => !!f && !Object.keys(f.context.dimensions).length)
        .map((f) => [f.tag, f])
    );
    const baseFact = consolidated.get(netSource.tag);
    if (!baseFact || baseFact.value !== period.metrics.netIncome) continue;
    for (const table of tables) {
      const rows = tableRows(table, refs, consolidated);
      if (!rows) continue;
      const lines = rows.map((r) =>
        r.facts.length === 1 && r.facts[0] && !Object.keys(r.facts[0].context.dimensions).length
          ? { label: r.label, fact: r.facts[0] }
          : undefined
      );
      // An EPS reconciliation alone is insufficient: this must also contain the
      // unchanged consolidated revenue, pretax and tax rows for the same period.
      if (
        !(["revenue", "pretaxIncome", "incomeTax"] as const).every((key) =>
          lines.some(
            (l) =>
              l &&
              l.fact.value === period.metrics[key] &&
              l.fact.tag === period.metricSources[key]?.tag
          )
        )
      )
        continue;
      const candidates = lines.flatMap((l, i) =>
        l &&
        l.fact.value === baseFact.value &&
        (l.fact.tag === netSource.tag || (scope === "parent" && l.fact.tag === dilutedIncomeTag))
          ? [i]
          : []
      );
      if (candidates.length !== 1) continue;
      const index = candidates[0],
        originalBase = lines[index]!;
      const allocations: ShareholderIncomeBridge["allocations"] = [];
      let running = baseFact.value;
      let bridge: ShareholderIncomeBridge | undefined;
      for (let i = index + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l) break;
        if (l.fact.tag === commonIncomeTag) {
          if (
            allocations.length &&
            Math.abs(running - l.fact.value) <= Math.max(1e-6, period.metrics.revenue! * 1e-9)
          )
            bridge = {
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              filedAt: filing.filedAt,
              base: {
                label: originalBase.label,
                tag: originalBase.fact.tag,
                amount: baseFact.value,
                scope,
                decimals: originalBase.fact.decimals,
                ...(originalBase.fact.tag !== netSource.tag
                  ? { corroboratingTag: netSource.tag }
                  : {})
              },
              common: {
                label: l.label,
                tag: l.fact.tag,
                amount: l.fact.value,
                decimals: l.fact.decimals
              },
              allocations
            };
          break;
        }
        if (!(
          shareholderAllocationTags.has(l.fact.tag) ||
          (scope === "consolidated" && minorityIncomeTag.test(l.fact.tag))
        ))
          break;
        allocations.push({
          id: `shareholder-${i}-${l.fact.tag.split(":").at(-1)}`,
          label: l.label,
          tag: l.fact.tag,
          amount: l.fact.value,
          decimals: l.fact.decimals
        });
        running -= l.fact.value;
      }
      if (!bridge) continue;
      const next = { ...period, shareholderBridge: bridge };
      if (shareholderBridgeProblem(next) || !flowPeriod(next)) continue;
      output.push(next);
      break;
    }
  }
  return output;
}
