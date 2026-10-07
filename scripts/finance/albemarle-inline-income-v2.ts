import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  albInlineIncomeRule,
  enrichOriginalAlbemarleInlineIncome,
  type AlbemarleInlineIncomeProof
} from "../../src/features/finance/albemarle-inline-income";
import { visibleText } from "./business-v2";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { originalRevenueGrid, InvalidRevenueGrid } from "./original-revenue-grid";
import { flowPeriod } from "./v2-model";

/** Same original primary scope used in offline audit and persistent SEC imports.
 * No dimensional, narrative, YTD or second primary table can fill a missing line. */
export function enrichAlbemarleInlineIncomePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  if (
    identity.cik !== "0000915913" ||
    !/^10-Q(?:\/A)?$/.test(filing.form) ||
    !filing.reportDate.endsWith("-06-30")
  )
    return [];
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
    throw Error("Original quarterly income issuer mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original quarterly income tables.");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik),
    out: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.sankey ||
      p.kind !== "quarterly" ||
      p.sourceUrl !== filing.sourceUrl ||
      p.accession !== filing.accession ||
      p.filedAt !== filing.filedAt
    )
      continue;
    const accepted: PeriodV2[] = [];
    for (const [tableIndex, t] of tables.entries()) {
      if (
        !t[0].includes("us-gaap:GainLossOnSaleOfBusiness") ||
        !t[0].includes("us-gaap:NetIncomeLoss")
      )
        continue;
      const title = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!)).match(
        /(Albemarle Corporation and Subsidiaries CONSOLIDATED STATEMENTS OF INCOME) \(In Thousands, Except Per Share Amounts\) \(Unaudited\)$/i
      )?.[1];
      if (!title) continue;
      const rawRows = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const parent = rawRows.findIndex(
        ([r]) =>
          visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "") ===
          "Net income attributable to Albemarle Corporation"
      );
      if (parent !== 20) continue;
      try {
        const proof: AlbemarleInlineIncomeProof = {
          ruleId: albInlineIncomeRule,
          reportDate: filing.reportDate,
          form: filing.form,
          originalFiscalYear: parsed.fiscalYear,
          title,
          tableIndex,
          units,
          rows: grid(t[0], new Set(Array.from({ length: parent + 1 }, (_, i) => i)))
        };
        const next = enrichOriginalAlbemarleInlineIncome(p, proof);
        next.coverage.sankey = !!flowPeriod(next);
        if (next.coverage.sankey) accepted.push(next);
      } catch (e) {
        if (!(e instanceof InvalidRevenueGrid) && !(e instanceof Error)) throw e;
      }
    }
    // More than one independently qualified primary scope is ambiguous, even
    // when both happen to contain the same numbers.
    if (accepted.length === 1) out.push(accepted[0]);
  }
  return out;
}
