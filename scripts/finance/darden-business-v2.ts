import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type {
  DardenRevenueProof,
  DardenSourceFocus
} from "../../src/features/finance/darden-types";
import {
  originalDardenRevenuePartition,
  dardenRevenueBasis
} from "../../src/features/finance/darden-revenue";
import {
  originalCellEncoding,
  encodeOriginalRows
} from "../../src/features/finance/original-cell-tuples";
import { visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";
import { originalDardenPrimaryColumns } from "../../src/features/finance/darden-source";

export function originalDardenFocus(
  html: string,
  filing: SecFiling,
  parsed: ParsedFiling,
  units: DardenSourceFocus["units"]
): DardenSourceFocus | undefined {
  const text = visibleText(html),
    calendar = [...text.matchAll(/.{0,120}52\/53[ -]week fiscal year.{0,240}/gi)]
      .map((m) => m[0])
      .find((s) => s.includes("last Sunday in May"));
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

/** The complete original revenue regions are collected once. No subset, annual
 * mix, corporate residual or alternative classification fills an unknown table. */
export function enrichDardenBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: { id: string; reason: string }) => void
): PeriodV2[] {
  if (identity.cik !== "0000940944" || parsed.fiscalYear < 2019) return [];
  const u = new URL(filing.sourceUrl);
  if (
    u.origin !== "https://www.sec.gov" ||
    u.username ||
    u.password ||
    !u.pathname.startsWith(
      "/Archives/edgar/data/940944/" + filing.accession.replaceAll("-", "") + "/"
    )
  )
    throw Error("Original Darden source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Darden tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik, 6, [-5, -6]),
    focus = originalDardenFocus(html, filing, parsed, units);
  if (!focus) return [];
  const primary: DardenRevenueProof["primary"][] = [],
    business: DardenRevenueProof["tables"] = [];
  for (const [tableIndex, t] of tables.entries()) {
    if (t[0].length > 512000) continue;
    const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
      labels = raw.map(([r]) =>
        visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
      ),
      sales = labels.indexOf("Sales"),
      tax = labels.findIndex((l) =>
        /^(?:Income tax expense|Income tax expense \(benefit\)|Income tax benefit|Income tax \(benefit\) expense)$/.test(
          l
        )
      );
    const before = visibleText(html.slice(Math.max(0, t.index! - 1500), t.index!));
    if (
      sales > 0 &&
      tax > sales &&
      /CONSOLIDATED STATEMENTS OF (?:EARNINGS|INCOME)/i.test(before)
    ) {
      try {
        const rows = grid(t[0], new Set([...Array.from({ length: sales + 1 }, (_x, i) => i), tax]));
        // Original untagged duplicate display tables are not a second primary
        // monetary statement. Require all actual declared date columns first.
        originalDardenPrimaryColumns({
          ...focus,
          primary: {
            tableIndex,
            title: before,
            headerRows: rows.filter((r) => r.rowIndex < sales),
            revenue: rows.find((r) => r.rowIndex === sales)!,
            tax: rows.find((r) => r.rowIndex === tax)!
          }
        });
        primary.push({
          tableIndex,
          title: before,
          headerRows: encodeOriginalRows(rows.filter((r) => r.rowIndex < sales)),
          revenue: encodeOriginalRows([rows.find((r) => r.rowIndex === sales)!])[0],
          tax: encodeOriginalRows([rows.find((r) => r.rowIndex === tax)!])[0]
        });
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        onWithheld?.({ id: "primary", reason: e.message });
      }
    }
    if (
      !/Olive Garden/.test(visibleText(t[0])) ||
      !/LongHorn Steakhouse/.test(visibleText(t[0])) ||
      !t[0].includes("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax")
    )
      continue;
    const sourceSalesRows = labels.flatMap((l, i) => (l === "Sales" ? [i] : []));
    if (!sourceSalesRows.length) continue;
    try {
      const regions = sourceSalesRows.map((i) => {
        if (i < 3) throw Error("Incomplete original Darden revenue headers");
        return encodeOriginalRows(grid(t[0], new Set([i - 3, i - 2, i - 1, i])));
      });
      business.push({ tableIndex, sourceSalesRows, regions });
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      onWithheld?.({ id: "business", reason: e.message });
      return [];
    }
  }
  if (primary.length !== 1 || !business.length) {
    onWithheld?.({
      id: "source",
      reason: `Original independent primary missing or ambiguous: primary=${primary.length}, business=${business.length}`
    });
    return [];
  }
  const proof: DardenRevenueProof = {
      ...focus,
      ruleId: "dri-original-complete-revenue-v1",
      encoding: originalCellEncoding,
      tables: business,
      primary: primary[0]
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
      const original = originalDardenRevenuePartition(p, proof),
        next: PeriodV2 = {
          ...p,
          segments: original.segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: dardenRevenueBasis,
          businessBreakdownSource: {
            method: "reviewed-darden-revenue",
            ruleId: proof.ruleId,
            dardenRevenue: proof,
            tableIndex: original.tableIndex,
            totalTableIndex: proof.primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue!.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: original.totalDecimals,
            totalLabel: original.totalLabel,
            omittedSubtotals: [],
            omittedZeroColumns: [original.originalCorporateZero]
          },
          coverage: { ...p.coverage, segments: true }
        };
      if (!businessPeriod(next)) throw Error("Original Darden business proof envelope failed");
      next.coverage.sankey = !!flowPeriod(next);
      out.push(next);
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      onWithheld?.({ id: p.id, reason: e.message });
    }
  }
  return out;
}
