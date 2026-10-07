import type { OriginalBusinessHierarchyProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  OriginalHierarchyProofError,
  originalHierarchyBasis,
  originalHierarchySegments
} from "../../src/features/finance/original-hierarchy-revenue";
import { OriginalRevenueRowsError } from "../../src/features/finance/original-revenue-rows";
import { visibleText } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { InvalidRevenueGrid, originalRevenueGrid } from "./original-revenue-grid";
import { businessPeriod, flowPeriod } from "./v2-model";
const rowLabel = (r: string) => visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "");
/** Read finite reviewed original hierarchies. The full original table, all
 * geographical/product corroboration, fiscal captions and independent primary
 * revenue/tax columns survive; old financial values are never replaced. */
export function enrichOriginalHierarchyBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: {
    id: string;
    tableIndex: number;
    reason: string;
    proof?: OriginalBusinessHierarchyProof;
  }) => void
): PeriodV2[] {
  if (!["0000008818", "0000010456"].includes(identity.cik) || parsed.fiscalYear < 2023) return [];
  const baxter = identity.cik === "0000010456",
    url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    )
  )
    throw Error("Original hierarchy source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original hierarchy tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik, 6, [-5, -6]),
    text = visibleText(html);
  const fiscalCalendar = [
    ...text.matchAll(/(?:Our fiscal years?\b|In January 2025, the Audit Committee)[\s\S]{0,1800}/gi)
  ]
    .map((m) => m[0])
    .join("\n")
    .slice(0, 12000);
  const primary: OriginalBusinessHierarchyProof["primary"][] = [];
  const business: {
      tableIndex: number;
      rows: OriginalBusinessHierarchyProof["rows"];
      caption: string;
    }[] = [],
    materials: typeof business = [];
  for (const [tableIndex, t] of tables.entries()) {
    if (t[0].length > 512000) continue;
    const raw = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
      labels = raw.map((r) => rowLabel(r[0]));
    const before = visibleText(html.slice(Math.max(0, t.index! - 9000), t.index!)),
      after = visibleText(html.slice(t.index! + t[0].length, t.index! + t[0].length + 6000));
    if (t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) {
      const revenue = labels.findIndex((l) => /^Net sales$/i.test(l)),
        tax = raw.findIndex(
          (r, i) => i > revenue && r[0].includes('name="us-gaap:IncomeTaxExpenseBenefit"')
        );
      const title = before
        .match(/([^.!?]{0,180}CONSOLIDATED STATEMENTS OF (?:INCOME|LOSS)[^.!?]{0,100})$/i)?.[0]
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
    const main = baxter
      ? labels.includes("Total Baxter")
      : labels.includes("Total Materials Group") &&
        labels.includes("Total Solutions Group") &&
        labels.includes("Net sales to unaffiliated customers");
    const product =
      !baxter &&
      labels.includes("Total Materials Group") &&
      !labels.includes("Total Solutions Group") &&
      labels.includes("Labels, graphics and reflectives");
    if (!main && !product) continue;
    try {
      const rows = grid(t[0], new Set(raw.map((_r, i) => i))),
        record = {
          tableIndex,
          rows,
          caption: (before.slice(-6000) + "\n" + after.slice(0, 6000)).slice(0, 12000)
        };
      (main ? business : materials).push(record);
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
      p.metricSources.revenue?.method !== "reported" ||
      p.metricSources.revenue.tag !==
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD" ||
      p.fx ||
      p.revenueAdjustments?.length
    )
      continue;
    const primaries = primary.filter(
      (pr) =>
        pr.revenue.cells.filter(
          (c) =>
            c.fact?.startDate === p.startDate &&
            c.fact.endDate === p.endDate &&
            !Object.keys(c.fact.dimensions).length
        ).length === 1
    );
    if (primaries.length !== 1) {
      onWithheld?.({
        id: p.id,
        tableIndex: -1,
        reason: "Original independent primary table missing or ambiguous"
      });
      continue;
    }
    for (const b of business) {
      let proof: OriginalBusinessHierarchyProof | undefined;
      try {
        proof = {
          ruleId: baxter
            ? "bax-original-business-hierarchy-v1"
            : "avy-original-business-hierarchy-v1",
          reportDate: filing.reportDate,
          form: filing.form,
          originalFiscalYear: parsed.fiscalYear,
          originalFiscalPeriod: parsed.fiscalPeriod,
          units,
          tableIndex: b.tableIndex,
          rows: b.rows,
          caption: b.caption,
          fiscalCalendar,
          primary: primaries[0]
        };
        if (!baxter && p.kind === "annual") {
          const available = materials.filter((m) =>
            m.rows.some((r) =>
              r.cells.some((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)
            )
          );
          if (available.length > 1)
            throw new OriginalHierarchyProofError(
              "Original Materials product tables are ambiguous"
            );
          if (available.length === 1) proof.materialProducts = available[0];
        }
        const segments = originalHierarchySegments(p, proof),
          closing = proof.rows.filter((r) => r.cells.some((c) => c.fact)).at(-1)!,
          total = closing.cells.find(
            (c) =>
              c.fact?.startDate === p.startDate &&
              c.fact.endDate === p.endDate &&
              !c.fact.dimensions["srt:StatementGeographicalAxis"]
          );
        if (!total) throw new OriginalHierarchyProofError("Original worldwide total missing");
        const next: PeriodV2 = {
          ...p,
          segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: originalHierarchyBasis(proof),
          businessBreakdownSource: {
            method: "reviewed-original-business-hierarchy",
            ruleId: proof.ruleId,
            originalBusinessHierarchy: proof,
            tableIndex: b.tableIndex,
            totalTableIndex: proof.primary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession!,
            revenueTag: p.metricSources.revenue.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: total.fact!.decimals,
            totalLabel: closing.cells[0].label,
            omittedSubtotals: []
          },
          coverage: { ...p.coverage, segments: true }
        };
        if (!businessPeriod(next))
          throw new OriginalHierarchyProofError(
            "Original hierarchy proof envelope did not validate"
          );
        next.coverage.sankey = !!flowPeriod(next);
        output.push(next);
        break;
      } catch (e) {
        if (
          !(e instanceof InvalidRevenueGrid) &&
          !(e instanceof OriginalRevenueRowsError) &&
          !(e instanceof OriginalHierarchyProofError)
        )
          throw e;
        onWithheld?.({ id: p.id, tableIndex: b.tableIndex, reason: e.message, proof });
      }
    }
  }
  return output;
}
