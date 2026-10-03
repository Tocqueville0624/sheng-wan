import {
  businessAxes,
  businessRules,
  sameDimensions
} from "../../src/features/finance/business-rules";
import type { RevenueSegment } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { attribute, factKey, halfUnit, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

type RowFact = { fact: XbrlFact; column: number };
type Branch = RowFact & { label: string };
const scopes: Record<string, string>[] = [
  {},
  { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }
];

/** Read row totals of a product-by-segment matrix. Every branch and the explicit
 * total must occupy the same source column and share one classification/scope.
 * Interior cross-axis facts never enter a partition; no subsets or residuals
 * are searched to obtain a desired total. Column-headed tables remain separate.
 */
export function enrichMatrixBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  // A registered issuer schema stays fail-closed when its classifications change.
  if (businessRules.some((r) => r.cik === identity.cik)) return [];
  const url = new URL(filing.sourceUrl);
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik))
  )
    throw new Error("Business matrix source identity mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw new Error("Statement table count exceeds safe limits.");
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
    const groups = new Map<string, XbrlFact[]>();
    for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, f]));
    let selected: PeriodV2 | undefined;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        table.length > 512000 ||
        /<table\b/i.test(table.slice(6)) ||
        /rowspan=["'](?:[2-9]|\d{2,})["']/i.test(table)
      )
        continue;
      const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      if (rows.length > 500) continue;
      for (const axis of businessAxes) {
        for (const qualifiers of scopes) {
          let branches: Branch[] = [];
          for (const [row] of rows) {
            const cells = [...row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)];
            const label = visibleText(cells[0]?.[0] ?? "");
            let column = 0;
            const values: RowFact[] = [];
            let invalid = false;
            let currentRevenue = false;
            let currentFinancial = false;
            for (const [cell] of cells) {
              const span = Number(attribute(cell.match(/^<[^>]*>/)![0], "colspan") ?? 1);
              if (!Number.isInteger(span) || span < 1 || span > 200 || column + span > 1000) {
                invalid = true;
                break;
              }
              for (const [opening] of cell.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
                const f = refs.get(
                  `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`
                );
                if (!f) continue;
                currentFinancial = true;
                if (f.tag !== period.metricSources.revenue!.tag) continue;
                currentRevenue = true;
                const dimensions = f.context.dimensions;
                const expected = dimensions[axis]
                  ? { ...qualifiers, [axis]: dimensions[axis] }
                  : qualifiers;
                if (!sameDimensions(dimensions, expected)) continue;
                const candidate = best.get(factKey(f));
                if (!candidate || candidate.value < 0) invalid = true;
                else values.push({ fact: candidate, column });
              }
              column += span;
            }
            if (!currentRevenue) {
              if (currentFinancial) branches = [];
              continue;
            }
            if (invalid || values.length !== 1 || !label || label.length > 180) {
              branches = [];
              continue;
            }
            const value = values[0];
            if (sameDimensions(value.fact.context.dimensions, qualifiers)) {
              const total = value.fact;
              const difference = total.value - branches.reduce((sum, b) => sum + b.fact.value, 0);
              const bound = branches.reduce((sum, b) => sum + halfUnit(b.fact)!, halfUnit(total)!);
              if (
                branches.length >= 2 &&
                branches.length <= 20 &&
                /^(?:total(?:\s+.*)?|(?:net\s+)?(?:revenues?|sales)(?:\s+to\s+customers)?)$/i.test(
                  label
                ) &&
                total.value === period.metrics.revenue &&
                branches.every((b) => b.column === value.column) &&
                new Set(branches.map((b) => factKey(b.fact))).size === branches.length &&
                new Set(branches.map((b) => b.label)).size === branches.length &&
                Math.abs(difference) <= bound &&
                Math.abs(difference) <= total.value * 0.001
              ) {
                const segments: RevenueSegment[] = branches.map(({ fact, label }) => ({
                  id: `reported-${Object.values(fact.context.dimensions).join("-")}`.replace(
                    /[^a-zA-Z0-9_-]/g,
                    "-"
                  ),
                  label,
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
                    tableLabel: label
                  }
                }));
                const next: PeriodV2 = {
                  ...period,
                  segments,
                  segmentSourceUrl: filing.sourceUrl,
                  segmentBasis:
                    "Reported business revenue from the total column of one source-table classification. Cross-axis interior cells are excluded to avoid double counting.",
                  businessBreakdownSource: {
                    method: "statement-revenue-matrix",
                    tableIndex,
                    sourceUrl: filing.sourceUrl,
                    accession: filing.accession,
                    revenueTag: total.tag,
                    revenue: total.value,
                    revenueDecimals: total.decimals,
                    axis,
                    qualifiers,
                    columnIndex: value.column,
                    totalLabel: label,
                    omittedSubtotals: []
                  },
                  revenueAdjustments: difference
                    ? [{ id: "source-rounding", label: "Source rounding", revenue: difference }]
                    : undefined,
                  coverage: { ...period.coverage, segments: true }
                };
                if (businessPeriod(next)) {
                  next.coverage.sankey = !!flowPeriod(next);
                  selected = next;
                  break;
                }
              }
              branches = [];
            } else if (/^total\b/i.test(label)) branches = [];
            else branches.push({ ...value, label });
          }
          if (selected) break;
        }
        if (selected) break;
      }
      if (selected) break;
    }
    if (selected) output.push(selected);
  }
  return output;
}
