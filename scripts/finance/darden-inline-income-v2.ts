import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import type {
  DardenInlineIncomeProof,
  DardenLabelNotes
} from "../../src/features/finance/darden-types";
import {
  enrichOriginalDardenInlineIncome,
  dardenInlineIncomeRule
} from "../../src/features/finance/darden-inline-income";
import {
  originalCellEncoding,
  encodeOriginalRows
} from "../../src/features/finance/original-cell-tuples";
import { originalReviewedMillionDollarRows } from "../../src/features/finance/original-revenue-rows";
import { originalDardenFocus } from "./darden-business-v2";
import { visibleText, attribute } from "./business-v2";
import { originalRevenueGrid } from "./original-revenue-grid";
import type { ParsedFiling } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { flowPeriod } from "./v2-model";

/** Read the full original primary through net income. Monetary declarations in a
 * line label are preserved as annotations and independently replayed, while their
 * unchanged visible text remains in the original physical label cell. */
export function enrichDardenInlineIncomePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  periods: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (d: { id: string; reason: string }) => void
): PeriodV2[] {
  if (identity.cik !== "0000940944" || parsed.fiscalYear < 2024) return [];
  const u = new URL(filing.sourceUrl);
  if (
    u.origin !== "https://www.sec.gov" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.pathname.startsWith(
      "/Archives/edgar/data/940944/" + filing.accession.replaceAll("-", "") + "/"
    )
  )
    throw Error("Original Darden income source identity mismatch");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw Error("Too many original Darden income tables");
  const { grid, units } = originalRevenueGrid(html, parsed, identity.cik, 6, [-5, -6]),
    focus = originalDardenFocus(html, filing, parsed, units);
  if (!focus) return [];
  const proofs: DardenInlineIncomeProof[] = [];
  for (const [tableIndex, t] of tables.entries()) {
    if (t[0].length > 512000) continue;
    const title = visibleText(html.slice(Math.max(0, t.index! - 1500), t.index!));
    if (!/CONSOLIDATED STATEMENTS OF (?:EARNINGS|INCOME)/i.test(title)) continue;
    const rawRows = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)],
      labels = rawRows.map(([r]) =>
        visibleText(r.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "")
      ),
      sales = labels.indexOf("Sales"),
      net = labels.indexOf("Net earnings");
    if (sales < 0 || net <= sales) continue;
    try {
      let normalized = t[0];
      const notes: DardenLabelNotes[] = [];
      for (let i = 0; i <= net; i++) {
        const original = rawRows[i][0],
          first = original.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0];
        if (!first || !/<ix:nonFraction\b/i.test(first)) continue;
        if (
          !/^Losses from discontinued operations, net of tax benefit of \$/.test(visibleText(first))
        )
          throw Error("Unreviewed original Darden monetary row-label annotation");
        const rawNotes = [
          ...first.matchAll(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/gi)
        ].map(([x]) => x);
        if (
          rawNotes.length < 2 ||
          rawNotes.length > 4 ||
          /<ix:nonFraction\b/i.test(rawNotes.join("").replace(/<ix:nonFraction\b[^>]*>/gi, ""))
        )
          throw Error("Incomplete or nested original Darden tax notes");
        const annotations = rawNotes.map((d, index) => {
          const opening = d.match(/^<[^>]*>/)![0];
          if (
            attribute(opening, "name") !==
              "us-gaap:DiscontinuedOperationTaxEffectOfDiscontinuedOperation" ||
            attribute(opening, "sign") !== "-"
          )
            throw Error("Unreviewed original Darden tax-note meaning");
          const rows = grid("<table><tr><td>" + d + "</td></tr></table>", new Set([0]));
          originalReviewedMillionDollarRows(rows, units, identity.cik);
          return {
            index,
            originalDeclaration: d,
            originalLexical: visibleText(d),
            originalMonetaryCell: rows[0].cells[0]
          };
        });
        const plain = first.replace(
          /<ix:nonFraction\b[^>]*>([\s\S]*?)<\/ix:nonFraction>/gi,
          (_x, body: string) => "<span>" + body + "</span>"
        );
        if (visibleText(plain) !== visibleText(first) || /<ix:nonFraction\b/i.test(plain))
          throw Error("Original Darden label text changed while separating annotations");
        normalized = normalized.replace(original, original.replace(first, plain));
        notes.push({
          rowIndex: i,
          labelColumnIndex: 0,
          originalLabelCell: first,
          originalLabel: visibleText(first),
          annotations
        });
      }
      proofs.push({
        ...focus,
        ruleId: dardenInlineIncomeRule,
        encoding: originalCellEncoding,
        tableIndex,
        title,
        rows: encodeOriginalRows(
          grid(normalized, new Set(Array.from({ length: net + 1 }, (_x, i) => i)))
        ),
        labelNotes: notes
      });
    } catch (e) {
      if (!(e instanceof Error)) throw e;
      onWithheld?.({ id: "primary", reason: e.message });
    }
  }
  const out: PeriodV2[] = [];
  for (const p of periods) {
    if (
      p.coverage.sankey ||
      p.sourceUrl !== filing.sourceUrl ||
      p.accession !== filing.accession ||
      p.filedAt !== filing.filedAt
    )
      continue;
    const accepted: PeriodV2[] = [];
    for (const proof of proofs) {
      try {
        const next = enrichOriginalDardenInlineIncome(p, proof);
        next.coverage = { ...next.coverage, sankey: !!flowPeriod(next) };
        if (next.coverage.sankey) accepted.push(next);
        else
          onWithheld?.({
            id: p.id,
            reason: "Original Darden proof cannot form a retained coherent financial flow"
          });
      } catch (e) {
        if (!(e instanceof Error)) throw e;
        onWithheld?.({ id: p.id, reason: e.message });
      }
    }
    if (accepted.length === 1) out.push(accepted[0]);
  }
  return out;
}
