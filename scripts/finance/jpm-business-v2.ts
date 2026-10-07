import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { JpmRevenueProof } from "../../src/features/finance/jpm-types";
import type { ServiceRevenueRow } from "../../src/features/finance/types";
import { packJpmOriginalRows } from "../../src/features/finance/jpm-original-rows";
import {
  jpmRevenueBasis,
  originalJpmRevenuePartition
} from "../../src/features/finance/jpm-revenue";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";

/** Extract unchanged original matrices and primary revenue cells. Unknown
 * business meanings, missing complete columns or inconsistent totals are withheld. */
export function enrichJpmBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: { id: string; reason: string }) => void
): PeriodV2[] {
  if (identity.cik !== "0000019617") return [];
  try {
    const grid = originalRevenueGrid(
        html,
        parsed,
        identity.cik,
        6,
        [-6],
        "jpm-original-96-columns"
      ),
      tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
    if (tables.length > 5000) throw Error("Too many original JPM tables");
    const primary: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [],
      business: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [];
    for (const [tableIndex, table] of tables.entries()) {
      const raw = [...table[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
        labels = raw.map(([r]) =>
          visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
        ),
        closing = labels.indexOf("Total net revenue");
      if (closing < 0) continue;
      if (labels.includes("Revenue") && table[0].includes('name="us-gaap:NetIncomeLoss"'))
        primary.push({
          tableIndex,
          rows: grid.grid(table[0], new Set(Array.from({ length: closing + 1 }, (_, i) => i)))
        });
      if (
        labels.includes("Noninterest revenue") &&
        labels.includes("Net interest income") &&
        visibleText(table[0]).includes("As of or for the ") &&
        /Consumer & Community Banking|Corporate/.test(visibleText(table[0]))
      ) {
        const rows = grid.grid(table[0], new Set(Array.from({ length: closing + 1 }, (_, i) => i)));
        if (
          rows.some((r) =>
            r.cells.some(
              (c) =>
                c.fact?.tag === "us-gaap:RevenuesNetOfInterestExpense" &&
                Object.keys(c.fact.dimensions).length
            )
          )
        )
          business.push({ tableIndex, rows });
      }
    }
    if (primary.length !== 1 || ![2, 4].includes(business.length))
      throw Error(
        `Original JPM complete source regions missing or ambiguous: ${primary.length}/${business.length}`
      );
    const originalNotes: NonNullable<JpmRevenueProof["originalNotes"]> = [];
    if (["2024-06-30", "2024-09-30"].includes(filing.reportDate))
      for (const match of html.matchAll(/second quarter of 2024/gi)) {
        const start = html.lastIndexOf("<div", match.index),
          end = html.indexOf("</div>", match.index) + 6;
        if (start < 0 || end <= start || end - start > 3000) continue;
        const raw = html.slice(start, end),
          text = visibleText(raw);
        if (
          text.startsWith(
            "Business Segment Reorganization : Effective in the second quarter of 2024, the Firm reorganized its reportable business segments by combining the former Corporate & Investment Bank and Commercial Banking business segments"
          ) &&
          !originalNotes.some((n) => n.offset === start)
        )
          originalNotes.push({
            offset: start,
            endOffset: end,
            originalHtml: raw,
            originalText: text
          });
      }
    const packed = packJpmOriginalRows([primary[0].rows, ...business.map((r) => r.rows)]),
      proof: JpmRevenueProof = {
        ruleId: "jpm-original-complete-net-revenue-v1",
        encoding: "jpm-original-resource-tuples-v1",
        resources: packed.resources,
        reportDate: filing.reportDate,
        form: filing.form,
        originalFiscalYear: parsed.fiscalYear,
        originalFiscalPeriod: parsed.fiscalPeriod,
        units: grid.units,
        primary: { tableIndex: primary[0].tableIndex, rows: packed.rows[0] },
        business: business.map((r, i) => ({ tableIndex: r.tableIndex, rows: packed.rows[i + 1] })),
        ...(originalNotes.length ? { originalNotes } : {})
      };
    const out: PeriodV2[] = [];
    for (const period of periods) {
      if (
        period.coverage.segments ||
        period.sourceUrl !== filing.sourceUrl ||
        period.accession !== filing.accession ||
        period.filedAt !== filing.filedAt ||
        period.revenueAdjustments?.length
      )
        continue;
      try {
        const original = originalJpmRevenuePartition(period, proof),
          next: PeriodV2 = {
            ...period,
            segments: original.segments,
            revenueAdjustments: original.adjustments,
            segmentSourceUrl: period.sourceUrl,
            segmentBasis: jpmRevenueBasis,
            businessBreakdownSource: {
              method: "reviewed-jpm-revenue",
              ruleId: proof.ruleId,
              jpmRevenue: proof,
              tableIndex: original.tableIndex,
              totalTableIndex: proof.primary.tableIndex,
              sourceUrl: period.sourceUrl,
              accession: period.accession!,
              revenueTag: period.metricSources.revenue!.tag,
              revenue: period.metrics.revenue!,
              revenueDecimals: -6,
              totalLabel: "Total net revenue",
              omittedSubtotals: [],
              omittedZeroColumns: []
            },
            coverage: { ...period.coverage, segments: true }
          };
        if (!businessPeriod(next)) throw Error("Original JPM proof envelope failed");
        next.coverage.sankey = !!flowPeriod(next);
        out.push(next);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        onWithheld?.({ id: period.id, reason: error.message });
      }
    }
    return out;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    onWithheld?.({ id: "source", reason: error.message });
    return [];
  }
}
