import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { AmdRevenueProof, AmdSourceFocus } from "../../src/features/finance/amd-types";
import { amdBusinessProfiles } from "../../src/features/finance/amd-business-profiles";
import {
  originalAmdRevenuePartition,
  amdRevenueBasis
} from "../../src/features/finance/amd-revenue";
import {
  originalAmdPrimaryColumns,
  canonicalAmdSource
} from "../../src/features/finance/amd-source";
import {
  originalCellEncoding,
  encodeOriginalRows
} from "../../src/features/finance/original-cell-tuples";
import type { ServiceRevenueRow } from "../../src/features/finance/types";
import { visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

export function originalAmdFocus(
  html: string,
  filing: SecFiling,
  parsed: ParsedFiling,
  units: AmdSourceFocus["units"]
): AmdSourceFocus | undefined {
  const calendar = visibleText(html).match(
    /.{0,100}(?:52- or 53-week|52 or 53 week) fiscal year ending on the last Saturday in December.{0,160}/i
  )?.[0];
  if (!calendar || parsed.periodEnd !== filing.reportDate) return;
  return {
    reportDate: filing.reportDate,
    form: filing.form,
    originalFiscalYear: parsed.fiscalYear,
    originalFiscalPeriod: parsed.fiscalPeriod,
    fiscalCalendar: calendar,
    units
  };
}

/** Read complete original regions once. Printed MD&A is used only for the
 * reviewed conflicting-member schema, never to supply a missing branch. */
export function enrichAmdBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: { id: string; reason: string }) => void
): PeriodV2[] {
  if (identity.cik !== "0000002488" || parsed.fiscalYear < 2019) return [];
  const u = new URL(filing.sourceUrl);
  if (
    u.origin !== "https://www.sec.gov" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.pathname.startsWith(
      "/Archives/edgar/data/2488/" + filing.accession.replaceAll("-", "") + "/"
    )
  )
    throw Error("Original AMD source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original AMD tables");
  const reader = originalRevenueGrid(html, parsed, identity.cik, 6, [-6]),
    focus = originalAmdFocus(html, filing, parsed, reader.units);
  if (!focus) return [];
  const primary: AmdRevenueProof["primary"][] = [],
    business: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [],
    printed: { tableIndex: number; rows: ServiceRevenueRow[] }[] = [];
  for (const [tableIndex, t] of tables.entries()) {
    const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
      labels = raw.map(([r]) =>
        visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
      ),
      revenue = labels.indexOf("Net revenue"),
      tax = labels.findIndex((l) =>
        /^(?:Income tax provision(?: \(benefit\))?|Income tax \(benefit\)|Provision for \(benefit from\) income taxes)$/.test(
          l
        )
      );
    if (revenue > 0 && tax > revenue) {
      const preceding = visibleText(html.slice(Math.max(0, t.index! - 200000), t.index!)),
        titleStart = [
          ...preceding.matchAll(/(?:Condensed )?Consolidated Statements of Operations/gi)
        ].at(-1)?.index,
        title = titleStart === undefined ? "" : preceding.slice(titleStart);
      if (
        /^(?:Condensed )?Consolidated Statements of Operations(?: \(Unaudited\))?$/i.test(title)
      ) {
        try {
          const rows = reader.grid(
              t[0],
              new Set([...Array.from({ length: revenue + 1 }, (_, i) => i), tax])
            ),
            source = {
              tableIndex,
              title,
              headerRows: rows.filter((r) => r.rowIndex < revenue),
              revenue: rows.find((r) => r.rowIndex === revenue)!,
              tax: rows.find((r) => r.rowIndex === tax)!
            };
          originalAmdPrimaryColumns({ ...focus, primary: source });
          primary.push({
            ...source,
            headerRows: encodeOriginalRows(source.headerRows),
            revenue: encodeOriginalRows([source.revenue])[0],
            tax: encodeOriginalRows([source.tax])[0]
          });
        } catch (e) {
          if (!(e instanceof Error)) throw e;
          onWithheld?.({ id: "primary", reason: e.message });
        }
      }
    }
    const start = labels.indexOf("Net revenue:"),
      end = labels.indexOf("Total net revenue");
    if (start < 0 || end <= start) continue;
    try {
      const rows = reader.grid(t[0], new Set(Array.from({ length: end + 1 }, (_, i) => i))),
        entry = { tableIndex, rows };
      if (rows.some((r) => r.cells.some((c) => c.fact))) business.push(entry);
      else printed.push(entry);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      onWithheld?.({ id: "business", reason: e.message });
      // A malformed tagged region must not disappear from the source inventory.
      if (/<ix:nonFraction\b/i.test(t[0])) return [];
    }
  }
  if (primary.length !== 1 || business.length !== 1) {
    onWithheld?.({
      id: "source",
      reason: `Original AMD primary/business missing or ambiguous: ${primary.length}/${business.length}`
    });
    return [];
  }
  const b = business[0],
    monetary = b.rows.filter((r) => r.cells.some((c) => c.fact)),
    classification = monetary.map((r) => {
      const f = r.cells.find((c) => c.fact)!.fact!;
      return { label: r.cells[0].label, tag: f.tag, dimensions: f.dimensions };
    }),
    profile = amdBusinessProfiles.find(
      (pr) => canonicalAmdSource(pr.rows) === canonicalAmdSource(classification)
    ),
    needsMda = !!profile?.requiresIndependentMda,
    display = b.rows.map((r) => ({
      rowIndex: r.rowIndex,
      cells: r.cells.map((c) => ({
        columnIndex: c.columnIndex,
        span: c.span,
        rowSpan: c.rowSpan,
        label: c.label
      }))
    })),
    mda = needsMda
      ? printed.filter((m) => canonicalAmdSource(m.rows) === canonicalAmdSource(display))
      : [];
  if (needsMda && mda.length !== 1) {
    onWithheld?.({
      id: "mda",
      reason: "Original disputed member names lack unique complete MD&A corroboration"
    });
    return [];
  }
  const proof: AmdRevenueProof = {
      ...focus,
      ruleId: "amd-original-complete-revenue-v1",
      encoding: originalCellEncoding,
      tableIndex: b.tableIndex,
      rows: encodeOriginalRows(b.rows),
      primary: primary[0],
      classificationBasis: needsMda
        ? "original-row-captions-corroborated-by-mda"
        : "original-reported-scopes",
      ...(needsMda
        ? {
            independentMda: { tableIndex: mda[0].tableIndex, rows: encodeOriginalRows(mda[0].rows) }
          }
        : {})
    },
    out: PeriodV2[] = [];
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
      const original = originalAmdRevenuePartition(p, proof),
        next: PeriodV2 = {
          ...p,
          segments: original.segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: amdRevenueBasis(proof),
          businessBreakdownSource: {
            method: "reviewed-amd-revenue",
            ruleId: proof.ruleId,
            amdRevenue: proof,
            tableIndex: original.tableIndex,
            totalTableIndex: proof.primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue!.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: original.totalDecimals,
            totalLabel: original.totalLabel,
            omittedSubtotals: original.omittedSubtotals,
            omittedZeroColumns: original.omittedZeroColumns
          },
          coverage: { ...p.coverage, segments: true }
        };
      if (!businessPeriod(next)) throw Error("Original AMD business proof envelope failed");
      next.coverage.sankey = !!flowPeriod(next);
      out.push(next);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      onWithheld?.({ id: p.id, reason: e.message });
    }
  }
  return out;
}
