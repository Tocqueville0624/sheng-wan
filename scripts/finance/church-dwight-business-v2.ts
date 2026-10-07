import type { ChurchDwightBusinessProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  churchDwightRevenueBasis,
  churchDwightRevenueSegments,
  ChurchDwightRevenueProofError
} from "../../src/features/finance/church-dwight-revenue";
import { OriginalRevenueRowsError } from "../../src/features/finance/original-revenue-rows";
import { visibleText } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { InvalidRevenueGrid, originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";

const label = (r: string) => visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "");
/** Read the complete original product hierarchy. Parent domestic revenue remains
 * corroboration, not an extra branch. Separate segment/geographic tables cannot
 * fill missing cells or replace the independent primary consolidated total. */
export function enrichChurchDwightBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (diagnostic: {
    id: string;
    tableIndex: number;
    reason: string;
    proof?: ChurchDwightBusinessProof;
  }) => void
): PeriodV2[] {
  if (identity.cik !== "0000313927") return [];
  const source = new URL(filing.sourceUrl);
  if (
    source.origin !== "https://www.sec.gov" ||
    source.username ||
    source.password ||
    !source.pathname.startsWith(
      `/Archives/edgar/data/313927/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== 313927)
  )
    throw Error("Church & Dwight source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Church & Dwight tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik, 6, [-5, -6]);
  const output: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.segments ||
      p.accession !== filing.accession ||
      p.sourceUrl !== filing.sourceUrl ||
      p.filedAt !== filing.filedAt ||
      p.metricSources.revenue?.method !== "reported" ||
      p.metricSources.revenue.tag !==
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD" ||
      p.revenueAdjustments?.length
    )
      continue;
    const primaries: ChurchDwightBusinessProof["primary"][] = [];
    for (const [tableIndex, t] of tables.entries()) {
      if (!t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) continue;
      const title = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!)).match(
        /(CHURCH & DWIGHT CO\., INC\. AND SUBSIDIARIES (?:CONDENSED )?CONSOL\s*IDATED STATEMENTS OF INCOME(?: \(LOSS\))?(?: \(Unaudited\))? \(In millions, except per share data\))$/i
      )?.[1];
      if (!title) continue;
      const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const revenueIndex = raw.findIndex(([r]) => label(r) === "Net Sales");
      const taxIndex = raw.findIndex(
        ([r], i) =>
          i > revenueIndex &&
          label(r) === "Income taxes" &&
          r.includes("us-gaap:IncomeTaxExpenseBenefit")
      );
      if (revenueIndex < 1 || taxIndex <= revenueIndex) continue;
      try {
        const rows = grid(
          t[0],
          new Set([...Array.from({ length: revenueIndex + 1 }, (_, i) => i), taxIndex])
        );
        const revenue = rows.find((r) => r.rowIndex === revenueIndex)!;
        if (
          revenue.cells.filter(
            (c) =>
              c.fact?.startDate === p.startDate &&
              c.fact.endDate === p.endDate &&
              c.fact.tag === p.metricSources.revenue?.tag &&
              !Object.keys(c.fact.dimensions).length &&
              Math.abs(c.fact.value - p.metrics.revenue!) <=
                Math.max(0.000001, Math.abs(c.fact.value) * Number.EPSILON)
          ).length !== 1
        )
          continue;
        primaries.push({
          tableIndex,
          title,
          headerRows: rows.filter((r) => r.rowIndex < revenueIndex),
          revenue,
          tax: rows.find((r) => r.rowIndex === taxIndex)!
        });
      } catch (e) {
        if (!(e instanceof InvalidRevenueGrid)) throw e;
        onWithheld?.({ id: p.id, tableIndex, reason: e.message });
      }
    }
    if (primaries.length !== 1) continue;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        tableIndex === primaries[0].tableIndex ||
        table.length > 512000 ||
        !visibleText(table).includes("Household Products")
      )
        continue;
      const raw = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const opening = raw.findIndex(([r]) => label(r) === "Household Products");
      const closing = raw.findIndex(([r]) => label(r) === "Total Consolidated Net Sales");
      if (
        opening < 1 ||
        closing !== opening + 5 ||
        raw.slice(closing + 1).some(([r]) => /<ix:nonFraction\b/i.test(r))
      )
        continue;
      let proof: ChurchDwightBusinessProof | undefined;
      try {
        const rows = grid(table, new Set(Array.from({ length: closing + 1 }, (_, i) => i)));
        proof = {
          ruleId: "chd-original-product-hierarchy-v1",
          reportDate: filing.reportDate,
          form: filing.form,
          originalFiscalYear: parsed.fiscalYear,
          units,
          tableIndex,
          headerRows: rows.filter((r) => r.rowIndex < opening),
          rows: rows.filter((r) => r.rowIndex >= opening),
          primary: primaries[0]
        };
        const segments = churchDwightRevenueSegments(p, proof);
        const next: PeriodV2 = {
          ...p,
          segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: churchDwightRevenueBasis,
          businessBreakdownSource: {
            method: "reviewed-church-dwight-revenue",
            ruleId: proof.ruleId,
            churchDwightRevenue: proof,
            tableIndex,
            totalTableIndex: proof.primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: proof.rows
              .at(-1)!
              .cells.find((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)!
              .fact!.decimals,
            totalLabel: "Total Consolidated Net Sales",
            omittedSubtotals: []
          },
          coverage: { ...p.coverage, segments: true }
        };
        if (!businessPeriod(next))
          throw new ChurchDwightRevenueProofError(
            "Original business proof envelope did not validate"
          );
        next.coverage.sankey = !!flowPeriod(next);
        output.push(next);
        break;
      } catch (e) {
        if (
          !(e instanceof InvalidRevenueGrid) &&
          !(e instanceof OriginalRevenueRowsError) &&
          !(e instanceof ChurchDwightRevenueProofError)
        )
          throw e;
        onWithheld?.({ id: p.id, tableIndex, reason: e.message, proof });
      }
    }
  }
  return output;
}
