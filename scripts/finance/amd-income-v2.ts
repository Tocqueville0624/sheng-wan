import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type { AmdInlineIncomeProof } from "../../src/features/finance/amd-types";
import { amdIncomeFlowView } from "../../src/features/finance/amd-inline-income";
import {
  originalCellEncoding,
  encodeOriginalRows
} from "../../src/features/finance/original-cell-tuples";
import { originalAmdFocus } from "./amd-business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import { visibleText } from "./business-v2";
import { flowPeriod } from "./v2-model";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";

/** Recover incomplete saved statements without replacing any indexed metric.
 * The original complete ledger separately explains the two pretax scopes. */
export function enrichAmdIncomePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  if (identity.cik !== "0000002488" || parsed.fiscalYear < 2019) return [];
  const candidates = periods.filter(
    (p) =>
      p.accession === filing.accession &&
      p.sourceUrl === filing.sourceUrl &&
      p.filedAt === filing.filedAt &&
      !p.amdInlineIncome &&
      !flowPeriod(p)
  );
  if (!candidates.length) return [];
  const reader = originalRevenueGrid(html, parsed, identity.cik, 6, [-6]),
    focus = originalAmdFocus(html, filing, parsed, reader.units);
  if (!focus) return [];
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)],
    proofs: AmdInlineIncomeProof[] = [];
  if (tables.length > 5000) throw Error("Too many original AMD income tables");
  for (const [tableIndex, t] of tables.entries()) {
    const labels = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(([r]) =>
        visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
      ),
      end = labels.findIndex((l) => /^Net income(?: \(loss\))?$/.test(l));
    if (end < 0 || !labels.includes("Net revenue")) continue;
    const preceding = visibleText(html.slice(Math.max(0, t.index! - 200000), t.index!)),
      titleStart = [
        ...preceding.matchAll(/(?:Condensed )?Consolidated Statements of Operations/gi)
      ].at(-1)?.index,
      title = titleStart === undefined ? "" : preceding.slice(titleStart);
    if (!/^(?:Condensed )?Consolidated Statements of Operations(?: \(Unaudited\))?$/i.test(title))
      continue;
    try {
      const rows = reader.grid(t[0], new Set(Array.from({ length: end + 1 }, (_, i) => i)));
      proofs.push({
        ...focus,
        ruleId: "amd-original-complete-income-v1",
        encoding: originalCellEncoding,
        tableIndex,
        title,
        rows: encodeOriginalRows(rows)
      });
    } catch {
      /* Unknown original declarations remain withheld; existing data survives. */
    }
  }
  const out: PeriodV2[] = [];
  for (const p of candidates) {
    const matches: PeriodV2[] = [];
    for (const proof of proofs) {
      try {
        const next = { ...p, amdInlineIncome: proof, coverage: { ...p.coverage, sankey: true } };
        amdIncomeFlowView(next);
        if (flowPeriod(next)) matches.push(next);
      } catch {
        /* Every column and retained amount must validate independently. */
      }
    }
    if (matches.length === 1) out.push(matches[0]);
  }
  return out;
}
