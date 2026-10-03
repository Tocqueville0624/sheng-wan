import {
  businessRules,
  sameDimensions,
  sourceLabel
} from "../../src/features/finance/business-rules";
import type { RevenueSegment } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { attribute, factKey, halfUnit, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

/** A reviewed vertical segment table: each source section provides its own revenue
 * subtotal. Corporate revenue must be an actual reported row, never a residual.
 */
export function enrichReviewedBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  const rules = businessRules.filter((r) => r.cik === identity.cik);
  if (!rules.length) return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik))
  )
    throw new Error("Reviewed business source identity mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  const output: PeriodV2[] = [];
  for (const period of existing) {
    if (
      period.coverage.segments ||
      period.accession !== filing.accession ||
      period.sourceUrl !== filing.sourceUrl ||
      period.filedAt !== filing.filedAt ||
      period.displayCurrency !== "USD" ||
      period.reportingCurrency !== "USD" ||
      (period.metrics.revenue ?? 0) <= 0 ||
      period.metricSources.revenue?.method !== "reported" ||
      period.revenueAdjustments?.length
    )
      continue;
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        f.currency === "USD" &&
        !f.context.typed &&
        Number.isFinite(f.value)
    );
    const grouped = new Map<string, XbrlFact[]>();
    for (const f of facts) grouped.set(factKey(f), [...(grouped.get(factKey(f)) ?? []), f]);
    const best = new Map([...grouped].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
    let selected: PeriodV2 | undefined;
    for (const rule of rules) {
      if (rule.totalTag !== period.metricSources.revenue.tag) continue;
      let separateTotal: { fact: XbrlFact; tableIndex: number } | undefined;
      if (rule.separateTotal) {
        for (const [index, [table]] of tables.entries()) {
          if (!/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)) continue;
          for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
            const label = sourceLabel(
              visibleText(row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? "")
            );
            if (label !== rule.totalLabel) continue;
            const total = [...row.matchAll(/<ix:nonFraction\b[^>]*>/gi)].flatMap(([opening]) => {
              const f = refs.get(
                `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`
              );
              return f &&
                f.tag === rule.totalTag &&
                !Object.keys(f.context.dimensions).length &&
                f.value === period.metrics.revenue
                ? [f]
                : [];
            });
            if (total.length === 1) separateTotal = { fact: total[0], tableIndex: index };
          }
        }
        if (!separateTotal) continue;
      }
      for (const [tableIndex, [table]] of tables.entries()) {
        if (table.length > 512000 || /<table\b/i.test(table.slice(6))) continue;
        let section = "";
        const matches = new Map<string, XbrlFact>();
        let total: XbrlFact | undefined = separateTotal?.fact;
        let invalid = false;
        const headers = new Set(
          [...table.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
            sourceLabel(visibleText(m[1]))
          )
        );
        if (rule.layout === "columns" && rule.branches.some((b) => !headers.has(b.label))) continue;
        for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
          const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
            visibleText(m[1])
          );
          const nonempty = cells.filter(Boolean);
          const label = sourceLabel(cells[0] ?? "");
          if (nonempty.length === 1 && !/<ix:nonFraction\b/i.test(row))
            section = sourceLabel(nonempty[0]);
          const seen = new Map<string, XbrlFact | undefined>();
          for (const [opening] of row.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
            const ref = `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`;
            if (refs.has(ref)) seen.set(ref, refs.get(ref));
          }
          const unique = new Map(
            [...seen.values()].filter((f): f is XbrlFact => !!f).map((f) => [factKey(f), f])
          );
          if (rule.layout !== "columns" && unique.size !== 1) continue;
          for (const f of unique.values()) {
            if (
              !Object.keys(f.context.dimensions).length &&
              f.tag === rule.totalTag &&
              label === rule.totalLabel &&
              f.value === period.metrics.revenue
            ) {
              total = f;
              continue;
            }
            const branch = rule.branches.find(
              (b) =>
                (rule.layout === "columns" || rule.layout === "rows" || b.label === section) &&
                b.rowLabel === label &&
                b.tag === f.tag &&
                sameDimensions(b.dimensions, f.context.dimensions)
            );
            if (branch) {
              const prior = matches.get(branch.label);
              if (prior && prior.value !== f.value) invalid = true;
              matches.set(branch.label, f);
            } else if (
              f.tag === rule.totalTag &&
              Object.keys(f.context.dimensions).length &&
              Object.keys(f.context.dimensions).some(
                (a) => a === "us-gaap:StatementBusinessSegmentsAxis"
              )
            )
              invalid = true;
          }
        }
        if (invalid || !total || matches.size !== rule.branches.length) continue;
        const rows = rule.branches.map((b) => ({ branch: b, fact: matches.get(b.label)! }));
        if (rows.some(({ fact }) => fact.value < 0 || halfUnit(fact) === undefined)) continue;
        const difference = total.value - rows.reduce((sum, r) => sum + r.fact.value, 0);
        const bound = rows.reduce((sum, r) => sum + halfUnit(r.fact)!, halfUnit(total)!);
        if (Math.abs(difference) > bound || Math.abs(difference) > total.value * 0.001) continue;
        const segments: RevenueSegment[] = rows.map(({ branch, fact }) => {
          const segment: RevenueSegment = {
            id: `reported-${branch.label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
            label: branch.label,
            revenue: fact.value,
            revenueSource: {
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              filedAt: filing.filedAt,
              startDate: period.startDate,
              endDate: period.endDate,
              currency: fact.currency,
              tag: fact.tag,
              dimensions: fact.context.dimensions,
              value: fact.value,
              decimals: fact.decimals,
              tableLabel: branch.label,
              rowLabel: branch.rowLabel
            }
          };
          const cost =
            branch.costTag &&
            best.get(
              `${branch.costTag}|${JSON.stringify(Object.entries(fact.context.dimensions).sort(([a], [b]) => a.localeCompare(b)))}`
            );
          if (cost && cost.value >= 0) {
            segment.grossProfit = fact.value - cost.value;
            segment.grossProfitSource = {
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              filedAt: filing.filedAt,
              startDate: period.startDate,
              endDate: period.endDate,
              reportingCurrency: "USD",
              method: "revenue-minus-cost",
              revenueTag: fact.tag,
              tag: cost.tag,
              dimensions: cost.context.dimensions,
              value: cost.value
            };
          }
          return segment;
        });
        const next: PeriodV2 = {
          ...period,
          segments,
          segmentSourceUrl: filing.sourceUrl,
          segmentBasis: rule.basis,
          businessBreakdownSource: {
            method: "reviewed-segment-table",
            ruleId: rule.id,
            tableIndex,
            totalTableIndex: separateTotal?.tableIndex,
            sourceUrl: filing.sourceUrl,
            accession: filing.accession,
            revenueTag: total.tag,
            revenue: total.value,
            revenueDecimals: total.decimals,
            totalLabel: rule.totalLabel,
            omittedSubtotals: []
          },
          revenueAdjustments: difference
            ? [{ id: "source-rounding", label: "Source rounding", revenue: difference }]
            : undefined,
          coverage: { ...period.coverage, segments: true }
        };
        if (!businessPeriod(next)) continue;
        next.coverage.sankey = !!flowPeriod(next);
        selected = next;
        break;
      }
      if (selected) break;
    }
    if (selected) output.push(selected);
  }
  return output;
}
