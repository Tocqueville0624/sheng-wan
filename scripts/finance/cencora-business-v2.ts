import type { CencoraBusinessProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  cencoraBusinessPartition,
  cencoraRevenueBasis,
  CencoraRevenueProofError
} from "../../src/features/finance/cencora-revenue";
import { OriginalRevenueRowsError } from "../../src/features/finance/original-revenue-rows";
import { visibleText } from "./business-v2";
import { originalRevenueGrid, InvalidRevenueGrid } from "./original-revenue-grid";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

/** Read the complete actual hierarchy, not a plausible subset of segment rows.
 * Original primary and business cells remain unchanged in the exported proof. */
export function enrichCencoraBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: {
    id: string;
    tableIndex: number;
    reason: string;
    proof?: CencoraBusinessProof;
  }) => void
): PeriodV2[] {
  if (identity.cik !== "0001140859" || parsed.fiscalYear < 2019) return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      "/Archives/edgar/data/1140859/" + filing.accession.replaceAll("-", "") + "/"
    )
  )
    throw Error("Original Cencora source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Cencora tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik, 3, [-3]);
  const primary: CencoraBusinessProof["primary"][] = [];
  const business: { tableIndex: number; rows: CencoraBusinessProof["rows"]; caption: string }[] =
    [];
  for (const [tableIndex, t] of tables.entries()) {
    if (t[0].length > 512000) continue;
    const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    const labels = raw.map((r) =>
      visibleText(r[0].match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
    );
    const before = visibleText(html.slice(Math.max(0, t.index! - 9000), t.index!));
    if (t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) {
      const revenue = labels.findIndex((l) => /^Revenue(?:s)?$/i.test(l));
      const tax = raw.findIndex(
        (r, i) => i > revenue && r[0].includes('name="us-gaap:IncomeTaxExpenseBenefit"')
      );
      const title = before
        .match(/([^.!?]{0,180}CONSOLIDATED STATEMENTS OF OPERATIONS[^.!?]{0,150})$/i)?.[0]
        ?.trim();
      if (revenue > 0 && tax > revenue && title) {
        try {
          const rows = grid(
            t[0],
            new Set([...Array.from({ length: revenue + 1 }, (_, i) => i), tax])
          );
          primary.push({
            tableIndex,
            title,
            headerRows: rows.filter((r) => r.rowIndex < revenue),
            revenue: rows.find((r) => r.rowIndex === revenue)!,
            tax: rows.find((r) => r.rowIndex === tax)!
          });
        } catch (e) {
          if (!(e instanceof InvalidRevenueGrid)) throw e;
        }
      }
    }
    if (!labels.includes("Revenue") || !labels.includes("Intersegment eliminations")) continue;
    try {
      business.push({
        tableIndex,
        rows: grid(t[0], new Set(raw.map((_r, i) => i))),
        caption:
          before.slice(-6000) +
          "\n" +
          visibleText(html.slice(t.index! + t[0].length, t.index! + t[0].length + 6000))
      });
    } catch (e) {
      if (!(e instanceof InvalidRevenueGrid)) throw e;
      onWithheld?.({ id: "source", tableIndex, reason: e.message });
    }
  }
  const output: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.segments ||
      p.accession !== filing.accession ||
      p.sourceUrl !== filing.sourceUrl ||
      p.filedAt !== filing.filedAt ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD" ||
      p.fx ||
      p.metricSources.revenue?.method !== "reported" ||
      p.metricSources.revenue.tag !== "us-gaap:Revenues" ||
      p.revenueAdjustments?.length
    )
      continue;
    const anchors = primary.filter(
      (pr) =>
        pr.revenue.cells.filter(
          (c) =>
            c.fact?.startDate === p.startDate &&
            c.fact.endDate === p.endDate &&
            !Object.keys(c.fact.dimensions).length
        ).length === 1
    );
    if (anchors.length !== 1) {
      onWithheld?.({
        id: p.id,
        tableIndex: -1,
        reason: "Independent original Cencora primary missing or ambiguous"
      });
      continue;
    }
    for (const b of business) {
      let proof: CencoraBusinessProof | undefined;
      try {
        proof = {
          ruleId: "cor-original-revenue-hierarchy-v1",
          reportDate: filing.reportDate,
          form: filing.form,
          originalFiscalYear: parsed.fiscalYear,
          originalFiscalPeriod: parsed.fiscalPeriod,
          units,
          tableIndex: b.tableIndex,
          rows: b.rows,
          caption: b.caption,
          primary: anchors[0]
        };
        const partition = cencoraBusinessPartition(p, proof);
        const next: PeriodV2 = {
          ...p,
          segments: partition.segments,
          revenueAdjustments: partition.adjustments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: cencoraRevenueBasis,
          businessBreakdownSource: {
            method: "reviewed-cencora-revenue",
            ruleId: proof.ruleId,
            cencoraRevenue: proof,
            tableIndex: b.tableIndex,
            totalTableIndex: proof.primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: partition.totalDecimals,
            totalLabel: partition.totalLabel,
            omittedSubtotals: []
          },
          coverage: { ...p.coverage, segments: true }
        };
        if (!businessPeriod(next))
          throw new CencoraRevenueProofError("Original Cencora proof envelope failed");
        next.coverage.sankey = !!flowPeriod(next);
        output.push(next);
        break;
      } catch (e) {
        if (
          !(e instanceof InvalidRevenueGrid) &&
          !(e instanceof OriginalRevenueRowsError) &&
          !(e instanceof CencoraRevenueProofError)
        )
          throw e;
        onWithheld?.({ id: p.id, tableIndex: b.tableIndex, reason: e.message, proof });
      }
    }
  }
  return output;
}
