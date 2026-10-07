import type { ServiceRevenueCell, ServiceRevenueRow } from "./types";
import type { PeriodV2 } from "./v2-types";
import type { DardenInlineIncomeProof } from "./darden-types";
import {
  originalCellEncoding,
  decodeOriginalRows,
  encodeOriginalRows
} from "./original-cell-tuples";
import {
  demandDardenSource as demand,
  canonicalDardenSource as canonical,
  validateDardenSourceFocus,
  originalDardenPrimaryColumns
} from "./darden-source";
import { dardenIncomeProfiles } from "./darden-income-profiles";
import {
  originalReviewedMillionDollarRows,
  originalExactMillionDollars
} from "./original-revenue-rows";
import { sameDimensions } from "./business-rules";

export const dardenInlineIncomeRule = "dri-original-complete-income-v1";
const gaap = (name: string) => `us-gaap:${name}`;
const noteTag = gaap("DiscontinuedOperationTaxEffectOfDiscontinuedOperation");
const discontinuedTag = gaap("IncomeLossFromDiscontinuedOperationsNetOfTax");
const pretaxTag = gaap(
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
);
const gainTag = gaap("GainLossOnSalesOfAssetsAndAssetImpairmentCharges");
const metricTags = {
  revenue: gaap("RevenueFromContractWithCustomerExcludingAssessedTax"),
  totalOperatingCosts: gaap("CostsAndExpenses"),
  operatingIncome: gaap("OperatingIncomeLoss"),
  pretaxIncome: pretaxTag,
  incomeTax: gaap("IncomeTaxExpenseBenefit"),
  discontinuedOperationsIncome: discontinuedTag,
  netIncome: gaap("NetIncomeLoss")
} as const;
// Exactly the same visible-text transformation as the original source reader.
// HTML is retained as evidence only and is never inserted into the page.
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([\da-f]+);/gi, (_, value: string) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const attr = (source: string, key: string) =>
  source.match(new RegExp(`\\b${key}=["']([^"']+)["']`))?.[1];
const inside = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
/** Preserve the source representation, including IEEE float values. A retained
 * integer-dollar company fact may independently match the exact original decimal;
 * this establishes equality without rounding or replacing that retained value. */
export function dardenOriginalMetricMatches(value: number | undefined, cell: ServiceRevenueCell) {
  return (
    value === cell.fact?.value ||
    (value !== undefined &&
      Number.isSafeInteger(value) &&
      BigInt(value) === originalExactMillionDollars(cell))
  );
}

/** All current, comparative and cumulative columns must reconcile before a single
 * selected period can be supplemented. Tax-benefit notes are annotations to an
 * already-net loss, never a second deduction or a substitute income-tax line. */
export function originalDardenInlineIncome(p: PeriodV2, proof: DardenInlineIncomeProof) {
  demand(
    proof.ruleId === dardenInlineIncomeRule &&
      proof.encoding === originalCellEncoding &&
      Object.keys(proof).every((k) =>
        [
          "ruleId",
          "encoding",
          "tableIndex",
          "title",
          "rows",
          "labelNotes",
          "reportDate",
          "form",
          "originalFiscalYear",
          "originalFiscalPeriod",
          "fiscalCalendar",
          "units"
        ].includes(k)
      ),
    "Changed original Darden income proof envelope"
  );
  validateDardenSourceFocus(p, proof);
  const rows = decodeOriginalRows(proof.rows);
  demand(
    rows.length >= 20 && rows.length <= 30 && rows.every((r, i) => r.rowIndex === i),
    "Missing complete original Darden primary rows"
  );
  originalReviewedMillionDollarRows(rows, proof.units, "0000940944");
  const monetary = rows.filter((r) => r.cells.some((c) => c.fact)),
    revenue = monetary[0],
    tax = monetary.find((r) =>
      r.cells.some((c) => c.fact?.tag === gaap("IncomeTaxExpenseBenefit"))
    );
  demand(
    revenue &&
      tax &&
      monetary.at(-1) === rows.at(-1) &&
      rows.at(-1)!.cells[0].label === "Net earnings",
    "Missing original Darden primary endpoints"
  );
  const columns = originalDardenPrimaryColumns({
    ...proof,
    primary: {
      tableIndex: proof.tableIndex,
      title: proof.title,
      headerRows: rows.slice(0, revenue.rowIndex),
      revenue,
      tax
    }
  });
  const shapes = monetary.map((r) => ({
    label: r.cells[0].label.replace(
      /net of tax benefit of \$.*/,
      "net of original reported tax benefits"
    ),
    facts: r.cells
      .filter((c) => c.fact)
      .map((c) => ({ tag: c.fact!.tag, dimensions: c.fact!.dimensions }))
  }));
  const profiles = dardenIncomeProfiles.filter(
    (profile) =>
      profile.rows.length === monetary.length &&
      profile.rows.every(
        (meaning, i) =>
          meaning.label === shapes[i].label &&
          shapes[i].facts.length === columns.length &&
          shapes[i].facts.every(
            (f) => f.tag === meaning.tag && sameDimensions(f.dimensions, meaning.dimensions)
          )
      )
  );
  demand(profiles.length === 1, "Unreviewed original Darden complete monetary ledger");
  const profile = profiles[0];
  for (const r of rows.slice(revenue.rowIndex)) {
    demand(!r.cells[0].fact, "Unresolved monetary annotation in original Darden line label");
    demand(
      r.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label)),
      "Unaccounted original Darden income amount"
    );
    if (!r.cells.some((c) => c.fact))
      demand(
        ["", "Costs and expenses:"].includes(r.cells[0].label),
        "Unreviewed original Darden primary section"
      );
  }
  demand(
    Array.isArray(proof.labelNotes) && proof.labelNotes.length === 1,
    "Missing original Darden tax-benefit notes"
  );
  const note = proof.labelNotes[0],
    noteRow = monetary.find((r) => r.cells.some((c) => c.fact?.tag === discontinuedTag));
  demand(
    noteRow &&
      note.rowIndex === noteRow.rowIndex &&
      note.labelColumnIndex === 0 &&
      Object.keys(note).every((k) =>
        [
          "rowIndex",
          "labelColumnIndex",
          "originalLabelCell",
          "originalLabel",
          "annotations"
        ].includes(k)
      ) &&
      typeof note.originalLabelCell === "string" &&
      note.originalLabelCell.length <= 16000 &&
      /^<td\b[^>]*>[\s\S]*<\/td>$/i.test(note.originalLabelCell) &&
      text(note.originalLabelCell) === note.originalLabel &&
      note.originalLabel === noteRow.cells[0].label &&
      /^Losses from discontinued operations, net of tax benefit of \$/.test(note.originalLabel),
    "Changed original Darden tax-benefit annotation label"
  );
  const rawNotes = [
    ...note.originalLabelCell.matchAll(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/gi)
  ].map(([x]) => x);
  demand(
    rawNotes.length === columns.length &&
      note.annotations.length === columns.length &&
      !/<ix:nonFraction\b/i.test(
        note.originalLabelCell.replace(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/gi, "")
      ),
    "Incomplete or nested original Darden tax annotations"
  );
  for (const [index, a] of note.annotations.entries()) {
    const raw = rawNotes[index],
      opening = raw.match(/^<[^>]*>/)![0],
      c = a.originalMonetaryCell,
      f = c.fact;
    demand(
      a.index === index &&
        a.originalDeclaration === raw &&
        a.originalLexical === text(raw) &&
        c.label === a.originalLexical &&
        c.columnIndex === 0 &&
        c.span === 1 &&
        c.rowSpan === 1 &&
        f &&
        f.tag === noteTag &&
        f.value < 0 &&
        !Object.keys(f.dimensions).length &&
        f.declarations.length === 1 &&
        Object.keys(a).every((k) =>
          ["index", "originalDeclaration", "originalLexical", "originalMonetaryCell"].includes(k)
        ),
      "Changed original Darden monetary label note"
    );
    originalReviewedMillionDollarRows([{ rowIndex: 0, cells: [c] }], proof.units, "0000940944");
    demand(
      !/<ix:nonFraction\b/i.test(raw.slice(opening.length)) &&
        attr(opening, "name") === f.tag &&
        attr(opening, "contextRef") === f.contextId &&
        attr(opening, "unitRef") === f.declarations[0].unitRef &&
        attr(opening, "scale") === "6" &&
        attr(opening, "decimals") === String(f.decimals) &&
        attr(opening, "sign") === "-" &&
        (attr(opening, "format") ?? "") === f.declarations[0].format &&
        attr(opening, "id") === f.declarations[0].id &&
        f.startDate === columns[index].scope.start &&
        f.endDate === columns[index].scope.end,
      "Original Darden label note declaration or date changed"
    );
  }
  const complete = columns.map((column) => {
    const slot = monetary.map((r, i) => {
      const matching = r.cells.filter(
        (c) => c.fact?.startDate === column.scope.start && c.fact.endDate === column.scope.end
      );
      demand(
        matching.length === 1 && inside(matching[0], column.dateColumn),
        "Missing original Darden physical income column"
      );
      const c = matching[0],
        f = c.fact!,
        meaning = profile.rows[i],
        sign = f.declarations[0].sign;
      demand(
        f.tag === meaning.tag && sameDimensions(f.dimensions, meaning.dimensions),
        "Changed original Darden income classification"
      );
      // A gain is a credit within the operating-cost ledger. Its positive XBRL
      // fact appears in parentheses, opposite to the expense presentation.
      const displayedNegative = /^\(\s*.*\s*\)$/.test(c.label);
      const opposite = f.tag === gainTag || f.tag === gaap("InterestIncomeExpenseNonoperatingNet");
      demand(
        f.value === 0
          ? /^[—–-]$/.test(c.label)
          : displayedNegative === (opposite ? f.value > 0 : f.value < 0) &&
              (sign === "-") === f.value < 0,
        "Changed original Darden displayed accounting sign"
      );
      return { row: r, cell: c };
    });
    const get = (tag: string) => {
      const matching = slot.filter((s) => s.cell.fact!.tag === tag);
      demand(matching.length === 1, "Incomplete original Darden unique income line");
      return matching[0];
    };
    const v = (tag: string) => originalExactMillionDollars(get(tag).cell),
      costIndex = slot.findIndex((s) => s.cell.fact!.tag === gaap("CostsAndExpenses")),
      costRows = slot.slice(1, costIndex),
      costs = costRows.reduce(
        (sum, s) =>
          sum +
          (s.cell.fact!.tag === gainTag
            ? -originalExactMillionDollars(s.cell)
            : originalExactMillionDollars(s.cell)),
        0n
      );
    demand(
      costRows.length >= 7 &&
        costRows.length <= 8 &&
        costRows.every((s) => s.cell.fact!.tag === gainTag || s.cell.fact!.value >= 0),
      "Unreviewed original Darden cost scope"
    );
    demand(
      costs === v(gaap("CostsAndExpenses")) &&
        v(metricTags.revenue) - costs === v(metricTags.operatingIncome) &&
        v(metricTags.operatingIncome) + v(gaap("InterestIncomeExpenseNonoperatingNet")) ===
          v(pretaxTag) &&
        v(pretaxTag) - v(metricTags.incomeTax) === v(gaap("IncomeLossFromContinuingOperations")) &&
        v(gaap("IncomeLossFromContinuingOperations")) + v(discontinuedTag) ===
          v(metricTags.netIncome),
      "Complete original Darden income identities do not reconcile"
    );
    return { column, get };
  });
  const selected = complete.filter(
    (c) => c.column.scope.start === p.startDate && c.column.scope.end === p.endDate
  );
  demand(selected.length === 1, "Selected Darden income differs from original primary scope");
  const lines = Object.fromEntries(
    Object.entries(metricTags).map(([key, tag]) => [key, selected[0].get(tag)])
  ) as Record<keyof typeof metricTags, { row: ServiceRevenueRow; cell: ServiceRevenueCell }>;
  const metrics = Object.fromEntries(
    Object.entries(lines).map(([key, line]) => [key, line.cell.fact!.value])
  ) as PeriodV2["metrics"];
  const metricSources = Object.fromEntries(
    Object.entries(lines).map(([key, line]) => [
      key,
      {
        label: line.row.cells[0].label,
        tag: line.cell.fact!.tag,
        sourceUrl: p.sourceUrl,
        accession: p.accession!,
        filedAt: p.filedAt,
        method: "reported",
        decimals: line.cell.fact!.decimals
      }
    ])
  ) as PeriodV2["metricSources"];
  return { metrics, metricSources, lines };
}
export function dardenInlineIncomeProblem(p: PeriodV2) {
  if (!p.dardenInlineIncome) return;
  try {
    const original = originalDardenInlineIncome(p, p.dardenInlineIncome);
    const business = p.businessBreakdownSource?.dardenRevenue;
    if (business) {
      const rows = decodeOriginalRows(p.dardenInlineIncome.rows),
        revenue = original.lines.revenue.row,
        tax = original.lines.incomeTax.row;
      demand(
        business.primary.tableIndex === p.dardenInlineIncome.tableIndex &&
          canonical(business.primary.headerRows) ===
            canonical(encodeOriginalRows(rows.slice(0, revenue.rowIndex))) &&
          canonical(business.primary.revenue) === canonical(encodeOriginalRows([revenue])[0]) &&
          canonical(business.primary.tax) === canonical(encodeOriginalRows([tax])[0]) &&
          [
            "reportDate",
            "form",
            "originalFiscalYear",
            "originalFiscalPeriod",
            "fiscalCalendar",
            "units"
          ].every(
            (key) =>
              canonical(business[key as keyof typeof business]) ===
              canonical(p.dardenInlineIncome![key as keyof DardenInlineIncomeProof])
          ),
        "Original Darden business and income primary proofs disagree"
      );
    }
    demand(
      !p.alignInlineIncome &&
        !p.grossOperatingItems &&
        !p.operatingItems &&
        !p.operatingNetItems &&
        !p.directNetItems &&
        !p.operatingExpenseDetails?.length &&
        !p.operatingCostDetails?.length &&
        !p.grossProfitAdjustments?.length &&
        !p.operatingReconciliation &&
        !p.afterTaxReconciliation &&
        !p.operatingExpensesBasis &&
        !p.roundedOperatingExpenseComponents &&
        !p.shareholderBridge &&
        !p.afterTaxTransactionItems,
      "Competing original Darden financial interpretation"
    );
    for (const key of Object.keys(original.lines) as (keyof typeof metricTags)[]) {
      const line = original.lines[key],
        source = p.metricSources[key];
      demand(
        dardenOriginalMetricMatches(p.metrics[key], line.cell) &&
          source?.method === "reported" &&
          source.tag === line.cell.fact!.tag &&
          source.sourceUrl === p.sourceUrl &&
          source.accession === p.accession &&
          source.filedAt === p.filedAt &&
          (source.decimals === undefined || source.decimals === line.cell.fact!.decimals),
        "Original Darden primary fact differs from retained metric or provenance"
      );
    }
    demand(
      canonical(p.metricSources.discontinuedOperationsIncome) ===
        canonical(original.metricSources.discontinuedOperationsIncome),
      "Changed original already-net Darden discontinued attribution"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Darden financial proof";
  }
}
export function enrichOriginalDardenInlineIncome(
  p: PeriodV2,
  proof: DardenInlineIncomeProof
): PeriodV2 {
  const original = originalDardenInlineIncome(p, proof),
    next: PeriodV2 = {
      ...p,
      metrics: { ...p.metrics },
      metricSources: { ...p.metricSources },
      dardenInlineIncome: proof
    };
  for (const key of Object.keys(original.metrics) as (keyof PeriodV2["metrics"])[]) {
    if (next.metrics[key] === undefined) {
      next.metrics[key] = original.metrics[key];
      next.metricSources[key] = original.metricSources[key];
    }
  }
  const error = dardenInlineIncomeProblem(next);
  if (error) throw Error(error);
  return next;
}
