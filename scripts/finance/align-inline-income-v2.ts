import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  alignInlineIncomeRule,
  enrichOriginalAlignInlineIncome,
  type AlignInlineIncomeProof
} from "../../src/features/finance/align-inline-income";
import { visibleText } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { flowPeriod } from "./v2-model";

export function enrichAlignInlineIncomePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  if (
    identity.cik !== "0001097149" ||
    filing.accession !== "0001097149-22-000011" ||
    filing.form !== "10-K" ||
    filing.reportDate !== "2021-12-31"
  )
    return [];
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Align primary tables.");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik),
    out: PeriodV2[] = [];
  for (const p of periods) {
    if (
      p.coverage.sankey ||
      p.kind !== "annual" ||
      p.sourceUrl !== filing.sourceUrl ||
      p.accession !== filing.accession ||
      p.filedAt !== filing.filedAt
    )
      continue;
    const accepted: PeriodV2[] = [];
    for (const [tableIndex, t] of tables.entries()) {
      const precedingText = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!));
      if (
        !precedingText.endsWith(
          "ALIGN TECHNOLOGY, INC. AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF OPERATIONS (in thousands, except per share data)"
        )
      )
        continue;
      try {
        const proof: AlignInlineIncomeProof = {
          ruleId: alignInlineIncomeRule,
          form: filing.form,
          reportDate: filing.reportDate,
          originalFiscalYear: parsed.fiscalYear,
          tableIndex,
          precedingText,
          units,
          rows: grid(t[0], new Set(Array.from({ length: 23 }, (_, i) => i)))
        };
        const next = enrichOriginalAlignInlineIncome(p, proof);
        next.coverage = { ...next.coverage, sankey: !!flowPeriod(next) };
        if (next.coverage.sankey) accepted.push(next);
      } catch (e) {
        if (!(e instanceof Error)) throw e;
      }
    }
    if (accepted.length === 1) out.push(accepted[0]);
  }
  return out;
}
