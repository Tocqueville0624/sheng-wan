import type { AlbemarleBusinessProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  albemarleRevenueBasis,
  albemarleRevenueSegments,
  AlbemarleRevenueProofError
} from "../../src/features/finance/albemarle-revenue";
import { visibleText } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { InvalidRevenueGrid, originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";

const label = (row: string) =>
  visibleText(row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "");
/** Only the independently reviewed issuer's complete original sections qualify.
 * Segment EBITDA expenses and geographic sales never supply business revenue. */
export function enrichAlbemarleBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (diagnostic: {
    id: string;
    tableIndex: number;
    reason: string;
    proof?: AlbemarleBusinessProof;
  }) => void
): PeriodV2[] {
  if (identity.cik !== "0000915913") return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/915913/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== 915913)
  )
    throw Error("Albemarle source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Albemarle tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik);
  const output: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.segments ||
      p.accession !== filing.accession ||
      p.sourceUrl !== filing.sourceUrl ||
      p.filedAt !== filing.filedAt ||
      p.metricSources.revenue?.method !== "reported" ||
      p.metricSources.revenue.tag !== "us-gaap:Revenues" ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD" ||
      p.revenueAdjustments?.length
    )
      continue;
    let primary: AlbemarleBusinessProof["primary"] | undefined;
    for (const [tableIndex, t] of tables.entries()) {
      if (!t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) continue;
      const title = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!)).match(
        /(Albemarle Corporation (?:and Subsidiaries )?(?:CONDENSED )?CONSOLIDATED STATEMENTS OF (?:\(LOSS\) INCOME|INCOME \(LOSS\)|INCOME|LOSS|OPERATIONS))(?: \(In Thousands, Except Per Share Amounts\))?(?: \(Unaudited\))?$/i
      )?.[1];
      if (!title) continue;
      const rawRows = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const revenueIndex = rawRows.findIndex(([r]) => label(r) === "Net sales"),
        taxIndex = rawRows.findIndex(
          ([r], i) => i > revenueIndex && r.includes("us-gaap:IncomeTaxExpenseBenefit")
        );
      if (revenueIndex < 1 || taxIndex <= revenueIndex) continue;
      try {
        const rows = grid(
          t[0],
          new Set([...Array.from({ length: revenueIndex + 1 }, (_, i) => i), taxIndex])
        );
        const revenue = rows.find((r) => r.rowIndex === revenueIndex)!,
          tax = rows.find((r) => r.rowIndex === taxIndex)!;
        if (
          revenue.cells.filter(
            (c) =>
              c.fact?.startDate === p.startDate &&
              c.fact.endDate === p.endDate &&
              c.fact.value === p.metrics.revenue &&
              !Object.keys(c.fact.dimensions).length
          ).length !== 1
        )
          continue;
        primary = {
          tableIndex,
          title,
          headerRows: rows.filter((r) => r.rowIndex < revenueIndex),
          revenue,
          tax
        };
        break;
      } catch (e) {
        if (!(e instanceof InvalidRevenueGrid)) throw e;
        onWithheld?.({ id: p.id, tableIndex, reason: e.message });
      }
    }
    if (!primary) continue;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        tableIndex === primary.tableIndex ||
        table.length > 512000 ||
        !table.includes("us-gaap:Revenues")
      )
        continue;
      const rawRows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      if (rawRows.length > 200) continue;
      const sections: { layout: "rows" | "columns"; indexes: number[]; headerIndexes: number[] }[] =
        [];
      const start = rawRows.findIndex(([r]) => label(r) === "Net sales:"),
        end = rawRows.findIndex(([r], i) => i > start && label(r) === "Total net sales");
      if (start >= 0 && end > start)
        sections.push({
          layout: "rows",
          indexes: Array.from({ length: end - start }, (_, i) => start + 1 + i),
          headerIndexes: Array.from({ length: start }, (_, i) => i)
        });
      for (const [i, [row]] of rawRows.entries())
        if (/^Net sales(?: \(a\))?$/.test(label(row)))
          sections.push({
            layout: "columns",
            indexes: [i],
            headerIndexes: rawRows.flatMap(([r], j) =>
              j < i && !/<ix:nonFraction\b/i.test(r) ? [j] : []
            )
          });
      let accepted = false;
      for (const section of sections) {
        let proof: AlbemarleBusinessProof | undefined;
        try {
          const rows = grid(table, new Set([...section.headerIndexes, ...section.indexes]));
          proof = {
            ruleId: "alb-original-revenue-section-v1",
            reportDate: filing.reportDate,
            form: filing.form,
            originalFiscalYear: parsed.fiscalYear,
            layout: section.layout,
            units,
            tableIndex,
            headerRows: rows.filter((r) => section.headerIndexes.includes(r.rowIndex)),
            rows: rows.filter((r) => section.indexes.includes(r.rowIndex)),
            primary
          };
          const segments = albemarleRevenueSegments(p, proof);
          const next: PeriodV2 = {
            ...p,
            segments,
            segmentSourceUrl: p.sourceUrl,
            segmentBasis: albemarleRevenueBasis,
            businessBreakdownSource: {
              method: "reviewed-albemarle-revenue",
              ruleId: proof.ruleId,
              albemarleRevenue: proof,
              tableIndex,
              totalTableIndex: primary.tableIndex,
              sourceUrl: p.sourceUrl,
              accession: p.accession,
              revenueTag: p.metricSources.revenue.tag,
              revenue: p.metrics.revenue!,
              revenueDecimals: -3,
              totalLabel: "Net sales",
              omittedSubtotals: []
            },
            coverage: { ...p.coverage, segments: true }
          };
          if (!businessPeriod(next))
            throw new AlbemarleRevenueProofError("Original proof envelope did not validate");
          next.coverage.sankey = !!flowPeriod(next);
          output.push(next);
          accepted = true;
          break;
        } catch (e) {
          if (!(e instanceof InvalidRevenueGrid) && !(e instanceof AlbemarleRevenueProofError))
            throw e;
          onWithheld?.({ id: p.id, tableIndex, reason: e.message, proof });
        }
      }
      if (accepted) break;
    }
  }
  return output;
}
