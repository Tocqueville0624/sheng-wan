import type { RevenueSegment } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { parseInlineXbrl, type ParsedFiling, type XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";
import { isBusinessCategory } from "../../src/features/finance/business-rules";

const revenueTags = new Set([
  "us-gaap:Revenues",
  "us-gaap:SalesRevenueNet",
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:RevenuesNetOfInterestExpense",
  "ifrs-full:Revenue"
]);
const businessAxes = new Set([
  "srt:ProductOrServiceAxis",
  "us-gaap:ProductOrServiceAxis",
  "us-gaap:StatementBusinessSegmentsAxis"
]);
export const dimensionsKey = (f: XbrlFact) =>
  JSON.stringify(Object.entries(f.context.dimensions).sort(([a], [b]) => a.localeCompare(b)));
export const factKey = (f: XbrlFact) => `${f.tag}|${dimensionsKey(f)}`;
export function halfUnit(f: XbrlFact) {
  return Number.isInteger(f.decimals) && f.decimals >= -18 && f.decimals <= 18
    ? 0.5 * 10 ** -f.decimals
    : undefined;
}
export function precise(copies: XbrlFact[]): XbrlFact | undefined {
  const ordered = [...copies].sort((a, b) => b.decimals - a.decimals);
  const first = ordered[0];
  if (!first || halfUnit(first) === undefined) return;
  for (const other of ordered.slice(1)) {
    if (other.value === first.value) continue;
    if (
      other.decimals === first.decimals ||
      halfUnit(other) === undefined ||
      Math.abs(other.value - first.value) > halfUnit(first)! + halfUnit(other)!
    )
      return;
  }
  return first;
}
export const attribute = (source: string, key: string) =>
  source.match(new RegExp(`\\b${key}=["']([^"']+)["']`))?.[1];
export function visibleText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([\da-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function revenueFact(f: XbrlFact, label: string) {
  const axes = Object.keys(f.context.dimensions);
  if (f.context.typed || axes.length > 1 || axes.some((axis) => !businessAxes.has(axis)))
    return false;
  if (axes.some((axis) => !isBusinessCategory(axis, f.context.dimensions[axis], label)))
    return false;
  if (revenueTags.has(f.tag)) return true;
  // An issuer's revenue line is accepted only inside the source table's revenue
  // section, followed by the existing consolidated revenue fact. No QName labels
  // or arbitrary combinations of non-dimensional numbers create a partition.
  const local = f.tag.split(":").at(-1)!;
  return (
    !axes.length &&
    /revenue|sales/i.test(local) &&
    !/cost|expense|tax|asset|liabil|defer|cash|interest|gain|loss|receiv|payable|purchase|capital/i.test(
      local
    )
  );
}
type Row = { label: string; fact: XbrlFact };

/** Discover a complete revenue section from a single financial statement table.
 * Every row is read in source order. Explicit subtotals are checked and omitted;
 * geographic, related-party, and cross-axis facts cannot enter the partition.
 */
export function enrichBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsedInput?: ParsedFiling
): PeriodV2[] {
  const url = new URL(filing.sourceUrl);
  const prefix = `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`;
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.protocol !== "https:" ||
    url.hostname !== "www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(prefix)
  )
    throw new Error("Business filing URL does not match the SEC issuer and accession.");
  const parsed = parsedInput ?? parseInlineXbrl(html);
  if (parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik)))
    throw new Error("Business source CIK does not match the catalog.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw new Error("Statement table count exceeds safe limits.");
  const output: PeriodV2[] = [];
  for (const period of existing) {
    if (
      period.coverage.segments ||
      period.accession !== filing.accession ||
      period.filedAt !== filing.filedAt ||
      period.sourceUrl !== filing.sourceUrl ||
      period.displayCurrency !== "USD" ||
      period.reportingCurrency !== "USD" ||
      !period.metrics.revenue ||
      period.metrics.revenue <= 0 ||
      period.metricSources.revenue?.method !== "reported" ||
      period.revenueAdjustments?.length
    )
      continue;
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        !f.context.typed &&
        f.currency === period.displayCurrency &&
        Number.isFinite(f.value)
    );
    const groups = new Map<string, XbrlFact[]>();
    for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))]));
    let selected: PeriodV2 | undefined;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (table.length > 512000 || /<table\b/i.test(table.slice(6))) continue;
      const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      if (rows.length > 500) continue;
      let candidates: Row[] = [];
      let omitted: NonNullable<PeriodV2["businessBreakdownSource"]>["omittedSubtotals"] = [];
      for (const [row] of rows) {
        const firstCell = row.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i)?.[1] ?? "";
        const label = visibleText(firstCell);
        const seen = new Map<string, XbrlFact | undefined>();
        for (const [opening] of row.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
          const key = `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`;
          if (refs.has(key)) seen.set(key, refs.get(key));
        }
        if (!seen.size) continue;
        if (seen.size !== 1 || ![...seen.values()][0] || !label || label.length > 180) {
          candidates = [];
          omitted = [];
          continue;
        }
        const f = [...seen.values()][0]!;
        if (!revenueFact(f, label) || f.value < 0) {
          candidates = [];
          omitted = [];
          continue;
        }
        const total =
          !Object.keys(f.context.dimensions).length &&
          f.tag === period.metricSources.revenue.tag &&
          f.value === period.metrics.revenue &&
          /\btotal\b.*\b(?:revenues?|sales)\b|^(?:net\s+)?(?:revenues?|sales)$/i.test(label);
        if (total) {
          const axes = new Set(candidates.flatMap((r) => Object.keys(r.fact.context.dimensions)));
          const unique = new Set(candidates.map((r) => factKey(r.fact)));
          const sum = candidates.reduce((value, r) => value + r.fact.value, 0);
          const difference = f.value - sum;
          const precisionBound = candidates.reduce(
            (value, r) => value + halfUnit(r.fact)!,
            halfUnit(f)!
          );
          if (
            candidates.length >= 2 &&
            candidates.length <= 20 &&
            axes.size <= 1 &&
            candidates.every((r) => Object.keys(r.fact.context.dimensions).length === axes.size) &&
            unique.size === candidates.length &&
            Math.abs(difference) <= precisionBound &&
            Math.abs(difference) <= f.value * 0.001
          ) {
            const segments: RevenueSegment[] = candidates.map(({ label, fact }) => ({
              id: `reported-${fact.tag}-${Object.values(fact.context.dimensions).join("-")}`.replace(
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
            for (let i = 0; i < segments.length; i++) {
              const revenue = candidates[i].fact;
              if (!Object.keys(revenue.context.dimensions).length) continue;
              const gross = best.get(`us-gaap:GrossProfit|${dimensionsKey(revenue)}`);
              const cost = best.get(`us-gaap:CostOfRevenue|${dimensionsKey(revenue)}`);
              const input = gross ?? cost;
              if (!input || (cost && !gross && cost.value < 0)) continue;
              const value = gross ? gross.value : revenue.value - input.value;
              if (value > revenue.value) continue;
              segments[i].grossProfit = value;
              segments[i].grossProfitSource = {
                sourceUrl: filing.sourceUrl,
                accession: filing.accession,
                filedAt: filing.filedAt,
                startDate: period.startDate,
                endDate: period.endDate,
                reportingCurrency: period.reportingCurrency,
                method: gross ? "reported" : "revenue-minus-cost",
                revenueTag: revenue.tag,
                tag: input.tag,
                dimensions: revenue.context.dimensions,
                value: input.value
              };
            }
            const axis = [...axes][0];
            const next: PeriodV2 = {
              ...period,
              segments,
              segmentSourceUrl: filing.sourceUrl,
              segmentBasis: axis?.endsWith("StatementBusinessSegmentsAxis")
                ? "Revenue by reported operating segment, using one classification from the cited statement table."
                : "Reported revenue sources in the cited statement table; subtotal rows are excluded to avoid double counting.",
              revenueAdjustments: difference
                ? [{ id: "source-rounding", label: "Source rounding", revenue: difference }]
                : undefined,
              businessBreakdownSource: {
                method: "statement-revenue-rows",
                tableIndex,
                sourceUrl: filing.sourceUrl,
                accession: filing.accession,
                revenueTag: f.tag,
                revenue: f.value,
                revenueDecimals: f.decimals,
                axis,
                totalLabel: label,
                omittedSubtotals: omitted
              },
              coverage: { ...period.coverage, segments: true }
            };
            if (businessPeriod(next)) {
              next.coverage.sankey = !!flowPeriod(next);
              selected = next;
              break;
            }
          }
          candidates = [];
          omitted = [];
        } else if (/^total\b/i.test(label)) {
          // Only an explicitly labelled, immediately following subtotal can be
          // skipped. This never searches arbitrary subsets for a desired total.
          let subtotal = 0;
          let error = halfUnit(f)!;
          let matches = 0;
          for (let i = candidates.length - 1; i >= 0; i--) {
            subtotal += candidates[i].fact.value;
            error += halfUnit(candidates[i].fact)!;
            if (candidates.length - i >= 2 && Math.abs(subtotal - f.value) <= error) matches++;
          }
          if (matches === 1)
            omitted.push({ label, tag: f.tag, dimensions: f.context.dimensions, value: f.value });
          else {
            candidates = [];
            omitted = [];
          }
        } else candidates.push({ label, fact: f });
      }
      if (selected) break;
    }
    if (selected) output.push(selected);
  }
  return output;
}
