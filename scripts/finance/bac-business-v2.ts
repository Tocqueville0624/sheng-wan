import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { BacOriginalNote, BacRevenueProof } from "../../src/features/finance/bac-types";
import { packBacOriginalRows } from "../../src/features/finance/bac-original-rows";
import type { ServiceRevenueRow } from "../../src/features/finance/types";
import {
  bacRevenueBasis,
  originalBacRevenuePartition
} from "../../src/features/finance/bac-revenue";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { attribute, visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";

const fteTag = "bac:RevenuesNetOfInterestExpenseFullTaxEquivalentBasis";
const noteTag = "bac:InterestIncomeExpenseNetFullTaxEquivalentBasisAfterTax";

function originalNotes(html: string): BacOriginalNote[] {
  const rawNotes = new Map<number, string>();
  for (const m of html.matchAll(
    /name="bac:InterestIncomeExpenseNetFullTaxEquivalentBasisAfterTax"/g
  )) {
    const start = html.lastIndexOf("<div", m.index),
      end = html.indexOf("</div>", m.index) + 6;
    if (start < 0 || end <= start || end - start > 10000)
      throw Error("Unbounded BAC original FTE footnote");
    const raw = html.slice(start, end);
    if (!visibleText(raw).includes("Segment results are presented on an FTE basis"))
      throw Error("Unknown original BAC FTE footnote role");
    rawNotes.set(start, raw);
  }
  if (!rawNotes.size) return [];
  const root = html.match(/<html\b[^>]*>/i)?.[0],
    closingRoot = html.match(/<\/html\s*>/i)?.[0];
  if (!root || !closingRoot) throw Error("Missing original BAC document root");
  const metadata: string[] = [];
  for (const m of html.matchAll(/<ix:nonNumeric\b[^>]*>/g)) {
    if (!/name="dei:Document(?:FiscalYearFocus|FiscalPeriodFocus|PeriodEndDate)"/.test(m[0]))
      continue;
    const tags = /<\/?ix:nonNumeric\b[^>]*>/g;
    tags.lastIndex = m.index! + m[0].length;
    let depth = 1,
      end = tags.lastIndex;
    for (let token = tags.exec(html); token; token = tags.exec(html)) {
      if (token.index - m.index! > 10000) break;
      depth += token[0].startsWith("</") ? -1 : 1;
      if (!depth) {
        end = tags.lastIndex;
        break;
      }
    }
    if (depth) throw Error("Unbounded original BAC fiscal metadata");
    metadata.push(html.slice(m.index, end));
  }
  const contexts = [
    ...html.matchAll(/<(?:[\w.-]+:)?context\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?context>/gi)
  ].map(([x]) => x);
  const units = [...html.matchAll(/<(?:[\w.-]+:)?unit\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?unit>/gi)].map(
    ([x]) => x
  );
  return [...rawNotes].map(([offset, raw]) => {
    const declarations = [...raw.matchAll(/<ix:nonFraction\b[^>]*>/gi)].map(([x]) => x);
    if (!declarations.every((x) => attribute(x, "name") === noteTag))
      throw Error("Mixed monetary declarations in original BAC note");
    const contextIds = new Set(declarations.map((x) => attribute(x, "contextRef"))),
      unitIds = new Set(declarations.map((x) => attribute(x, "unitRef")));
    return {
      offset,
      endOffset: offset + raw.length,
      html: raw,
      root,
      closingRoot,
      metadata,
      contexts: contexts.filter((x) => contextIds.has(attribute(x.match(/^<[^>]*>/)![0], "id"))),
      units: units.filter((x) => unitIds.has(attribute(x.match(/^<[^>]*>/)![0], "id")))
    };
  });
}

/** Read every original business revenue triplet and all primary comparison/YTD
 * columns. The reported FTE deduction is taken from its real table or footnote. */
export function enrichBacBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: { id: string; reason: string }) => void
): PeriodV2[] {
  if (identity.cik !== "0000070858") return [];
  const u = new URL(filing.sourceUrl),
    directory = `/Archives/edgar/data/70858/${filing.accession.replaceAll("-", "")}/`;
  if (
    u.origin !== "https://www.sec.gov" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.pathname.startsWith(directory) ||
    !/^[\w.-]+$/.test(u.pathname.slice(directory.length))
  )
    throw Error("Original BAC source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original BAC tables");
  const grid = originalRevenueGrid(html, parsed, identity.cik, 6, [-6], "bac-original-96-columns"),
    primary: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [],
    business: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [],
    reconciliation: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [];
  try {
    for (const [tableIndex, t] of tables.entries()) {
      const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
        labels = raw.map(([r]) => visibleText(r)),
        first = raw.map(([r]) =>
          visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
        );
      if (labels.includes("Consolidated Statement of Income")) {
        const end = first.indexOf("Total revenue, net of interest expense");
        if (end > 0)
          primary.push({
            tableIndex,
            rows: grid.grid(t[0], new Set(Array.from({ length: end + 1 }, (_, i) => i)))
          });
      }
      const matching = raw
        .map(([r], i) => (r.includes(`name="${fteTag}"`) ? i : -1))
        .filter((i) => i >= 0);
      if (
        matching.length &&
        labels.some((l) => /Results of Business Segments and All Other/.test(l)) &&
        /Consumer Banking/.test(visibleText(t[0]))
      ) {
        const selected = new Set<number>();
        for (const [j, ri] of matching.entries()) {
          let start = ri - 3;
          while (
            start > 0 &&
            !/Total Corporation|Consumer Banking|Global Wealth|Global Banking|Global Markets|All Other/.test(
              labels[start]
            )
          )
            start--;
          for (let i = j === 0 ? 0 : start; i <= ri; i++) selected.add(i);
        }
        business.push({ tableIndex, rows: grid.grid(t[0], selected) });
      }
      if (
        first.includes("FTE basis adjustment") &&
        first.some((l) => /^Segments’ total revenue, net of interest expense$/.test(l)) &&
        first.includes("Consolidated revenue, net of interest expense")
      ) {
        const end = first.indexOf("Consolidated revenue, net of interest expense");
        reconciliation.push({
          tableIndex,
          rows: grid.grid(t[0], new Set(Array.from({ length: end + 1 }, (_, i) => i)))
        });
      }
    }
    if (
      primary.length !== 1 ||
      !business.length ||
      business.length > 2 ||
      reconciliation.length > 1
    )
      throw Error(
        `Original BAC source regions missing or ambiguous: ${primary.length}/${business.length}/${reconciliation.length}`
      );
    const notes = originalNotes(html);
    if (!!reconciliation.length === !!notes.length)
      throw Error("Missing or mixed original BAC FTE source profiles");
    const packed = packBacOriginalRows([
      primary[0].rows,
      ...business.map((b) => b.rows),
      ...reconciliation.map((r) => r.rows)
    ]);
    const proof: BacRevenueProof = {
      ruleId: "bac-original-complete-revenue-v1",
      encoding: "bac-original-resource-tuples-v1",
      resources: packed.resources,
      reportDate: filing.reportDate,
      form: filing.form,
      originalFiscalYear: parsed.fiscalYear,
      originalFiscalPeriod: parsed.fiscalPeriod,
      units: grid.units,
      primary: { tableIndex: primary[0].tableIndex, rows: packed.rows[0] },
      business: business.map((b, i) => ({ tableIndex: b.tableIndex, rows: packed.rows[i + 1] })),
      ...(reconciliation.length
        ? {
            reconciliation: { tableIndex: reconciliation[0].tableIndex, rows: packed.rows.at(-1)! }
          }
        : { originalNotes: notes })
    };
    const out: PeriodV2[] = [];
    for (const p of periods) {
      if (
        p.coverage.segments ||
        p.sourceUrl !== filing.sourceUrl ||
        p.accession !== filing.accession ||
        p.filedAt !== filing.filedAt ||
        p.revenueAdjustments?.length
      )
        continue;
      try {
        const original = originalBacRevenuePartition(p, proof),
          next: PeriodV2 = {
            ...p,
            segments: original.segments,
            revenueAdjustments: original.adjustments,
            segmentSourceUrl: p.sourceUrl,
            segmentBasis: bacRevenueBasis,
            businessBreakdownSource: {
              method: "reviewed-bac-revenue",
              ruleId: proof.ruleId,
              bacRevenue: proof,
              tableIndex: original.tableIndex,
              totalTableIndex: proof.primary.tableIndex,
              sourceUrl: p.sourceUrl,
              accession: p.accession!,
              revenueTag: p.metricSources.revenue!.tag,
              revenue: p.metrics.revenue!,
              revenueDecimals: -6,
              totalLabel: "Total revenue, net of interest expense",
              omittedSubtotals: [],
              omittedZeroColumns: []
            },
            coverage: { ...p.coverage, segments: true }
          };
        if (!businessPeriod(next)) throw Error("Original BAC business proof envelope failed");
        next.coverage.sankey = !!flowPeriod(next);
        out.push(next);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        onWithheld?.({ id: p.id, reason: error.message });
      }
    }
    return out;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    onWithheld?.({ id: "source", reason: error.message });
    return [];
  }
}
