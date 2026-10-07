import type { AmetekBusinessProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  ametekRevenueBasis,
  ametekRevenueSegments
} from "../../src/features/finance/ametek-revenue";
import { OriginalRevenueRowsError } from "../../src/features/finance/original-revenue-rows";
import { AmetekRevenueProofError } from "../../src/features/finance/ametek-revenue";
import { visibleText } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { InvalidRevenueGrid, originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";

const label = (r: string) => visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "");
/** Read the original complete EIG/EMG closing row, not its geographic, product or
 * timing intersections. The independent primary statement supplies its own total. */
export function enrichAmetekBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (diagnostic: {
    id: string;
    tableIndex: number;
    reason: string;
    proof?: AmetekBusinessProof;
  }) => void
): PeriodV2[] {
  if (identity.cik !== "0001037868") return [];
  const source = new URL(filing.sourceUrl);
  if (
    source.origin !== "https://www.sec.gov" ||
    source.username ||
    source.password ||
    !source.pathname.startsWith(
      `/Archives/edgar/data/1037868/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== 1037868)
  )
    throw Error("AMETEK source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original AMETEK tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik),
    output: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.segments ||
      p.accession !== filing.accession ||
      p.sourceUrl !== filing.sourceUrl ||
      p.filedAt !== filing.filedAt ||
      p.metricSources.revenue?.method !== "reported" ||
      !/^us-gaap:RevenueFromContractWithCustomer(?:Including|Excluding)AssessedTax$/.test(
        p.metricSources.revenue.tag
      ) ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD" ||
      p.revenueAdjustments?.length
    )
      continue;
    const primaries: AmetekBusinessProof["primary"][] = [];
    for (const [tableIndex, t] of tables.entries()) {
      if (!t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) continue;
      const title = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!)).match(
        /(AMETEK, Inc\. Consolidated Statement of Income) \(In thousands, except per share amounts\)(?: \(Unaudited\))?$/i
      )?.[1];
      if (!title) continue;
      const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const revenueIndex = raw.findIndex(([r]) => label(r) === "Net sales");
      const taxIndex = raw.findIndex(
        ([r], i) =>
          i > revenueIndex &&
          label(r) === "Provision for income taxes" &&
          r.includes("us-gaap:IncomeTaxExpenseBenefit")
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
              c.fact.tag === p.metricSources.revenue?.tag &&
              c.fact.value === p.metrics.revenue &&
              !Object.keys(c.fact.dimensions).length
          ).length !== 1
        )
          continue;
        primaries.push({
          tableIndex,
          title,
          headerRows: rows.filter((r) => r.rowIndex < revenueIndex),
          revenue,
          tax
        });
      } catch (e) {
        if (!(e instanceof InvalidRevenueGrid)) throw e;
        onWithheld?.({ id: p.id, tableIndex, reason: e.message });
      }
    }
    if (primaries.length !== 1) continue;
    const primary = primaries[0];
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        tableIndex === primary.tableIndex ||
        table.length > 512000 ||
        !table.includes(p.metricSources.revenue.tag)
      )
        continue;
      const raw = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      if (raw.length > 200) continue;
      const closing = raw.findIndex(([r]) => label(r) === "Consolidated net sales");
      const firstAmount = raw.findIndex(([r]) => /<ix:nonFraction\b/i.test(r));
      if (closing < 0 || firstAmount < 1 || firstAmount > closing) continue;
      let proof: AmetekBusinessProof | undefined;
      try {
        const rows = grid(
          table,
          new Set([...Array.from({ length: firstAmount }, (_, i) => i), closing])
        );
        proof = {
          ruleId: "ame-original-closing-sales-v1",
          reportDate: filing.reportDate,
          form: filing.form,
          originalFiscalYear: parsed.fiscalYear,
          units,
          tableIndex,
          headerRows: rows.filter((r) => r.rowIndex < firstAmount),
          revenue: rows.find((r) => r.rowIndex === closing)!,
          primary
        };
        const segments = ametekRevenueSegments(p, proof);
        const next: PeriodV2 = {
          ...p,
          segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: ametekRevenueBasis,
          businessBreakdownSource: {
            method: "reviewed-ametek-revenue",
            ruleId: proof.ruleId,
            ametekRevenue: proof,
            tableIndex,
            totalTableIndex: primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: -3,
            totalLabel: "Consolidated net sales",
            omittedSubtotals: []
          },
          coverage: { ...p.coverage, segments: true }
        };
        if (!businessPeriod(next))
          throw new AmetekRevenueProofError("Original AMETEK proof envelope did not validate");
        next.coverage.sankey = !!flowPeriod(next);
        output.push(next);
        break;
      } catch (e) {
        if (
          !(e instanceof InvalidRevenueGrid) &&
          !(e instanceof OriginalRevenueRowsError) &&
          !(e instanceof AmetekRevenueProofError)
        )
          throw e;
        onWithheld?.({ id: p.id, tableIndex, reason: e.message, proof });
      }
    }
  }
  return output;
}
