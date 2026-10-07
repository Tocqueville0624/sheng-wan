import type { PeriodV2 } from "./v2-types";
import type { AmdRevenueProof } from "./amd-types";
import type { ServiceRevenueRow, ServiceRevenueCell, RevenueSegment } from "./types";
import { amdBusinessProfiles } from "./amd-business-profiles";
import {
  demandAmdSource,
  canonicalAmdSource,
  validateAmdSourceFocus,
  originalAmdPrimaryColumns,
  amdLiteralDate,
  amdFiscalScope
} from "./amd-source";
import { originalCellEncoding, decodeOriginalRows } from "./original-cell-tuples";
import {
  originalReviewedMillionDollarRows,
  originalExactMillionDollars
} from "./original-revenue-rows";

const demand: typeof demandAmdSource = demandAmdSource;
const integer = (n: number) => Number.isInteger(n) && n >= 0 && n <= 5000;
const inside = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
const printedRows = (rows: ServiceRevenueRow[]) =>
  rows.map((r) => ({
    rowIndex: r.rowIndex,
    cells: r.cells.map((c) => ({
      columnIndex: c.columnIndex,
      span: c.span,
      rowSpan: c.rowSpan,
      label: c.label
    }))
  }));

export function amdRevenueBasis(proof: AmdRevenueProof) {
  return (
    "Reported AMD business revenues from the complete original revenue section. All current, comparative and year-to-date columns reconcile to the independent primary statement. Client and Gaming are counted separately; their reported parent subtotal is corroboration only. No annual mix or business gross profit is estimated." +
    (proof.classificationBasis === "original-row-captions-corroborated-by-mda"
      ? " The original inline member names for Data Center, Client and Gaming disagree with their printed row captions. The chart follows the reported captions, independently corroborated by the identical complete MD&A table; the original member names remain unchanged in the source evidence."
      : "")
  );
}

/** Every column and row is validated before a selected period can acquire a
 * business capability. Exact original dollars reconcile; reported values remain. */
export function originalAmdRevenuePartition(p: PeriodV2, proof: AmdRevenueProof) {
  demand(
    Object.keys(proof).every((k) =>
      [
        "ruleId",
        "encoding",
        "tableIndex",
        "rows",
        "classificationBasis",
        "independentMda",
        "primary",
        "reportDate",
        "form",
        "originalFiscalYear",
        "originalFiscalPeriod",
        "fiscalCalendar",
        "units"
      ].includes(k)
    ) &&
      Object.keys(proof.primary).every((k) =>
        ["tableIndex", "title", "headerRows", "revenue", "tax"].includes(k)
      ) &&
      (!proof.independentMda ||
        Object.keys(proof.independentMda).every((k) => ["tableIndex", "rows"].includes(k))),
    "Unsupported mixed original AMD source proof"
  );
  demand(
    proof.ruleId === "amd-original-complete-revenue-v1" && proof.encoding === originalCellEncoding,
    "Changed original AMD revenue encoding"
  );
  validateAmdSourceFocus(p, proof);
  demand(
    integer(proof.tableIndex) && proof.tableIndex !== proof.primary.tableIndex,
    "Original business table is not independent of the primary"
  );
  const primary = originalAmdPrimaryColumns({
      ...proof,
      primary: {
        ...proof.primary,
        headerRows: decodeOriginalRows(proof.primary.headerRows),
        revenue: decodeOriginalRows([proof.primary.revenue])[0],
        tax: decodeOriginalRows([proof.primary.tax])[0]
      }
    }),
    rows = decodeOriginalRows(proof.rows);
  originalReviewedMillionDollarRows(rows, proof.units, "0000002488");
  demand(
    rows.length >= 7 && rows.length <= 12 && rows.every((r, i) => r.rowIndex === i),
    "Incomplete or reordered original AMD revenue section"
  );
  demand(
    rows.every((r) => r.cells.every((c) => !c.fact || c.fact.decimals === -6)),
    "Unreviewed original AMD precision"
  );
  const start = rows.findIndex((r) => r.cells[0].label === "Net revenue:"),
    monetary = rows.filter((r) => r.cells.some((c) => c.fact)),
    total = monetary.at(-1);
  demand(
    start >= 3 &&
      start <= 5 &&
      total &&
      total === rows.at(-1) &&
      total.cells[0].label === "Total net revenue" &&
      monetary.length >= 3,
    "Missing complete original AMD revenue boundary"
  );
  const headers = rows.slice(0, start),
    dateRows = headers.filter((r) =>
      r.cells.some((c) => amdLiteralDate(c.label) || /^20\d{2}$/.test(c.label))
    ),
    units = headers.filter((r) => r.cells.some((c) => c.label === "(In millions)"));
  demand(
    headers.every((r) => r.cells.every((c) => !c.fact)) &&
      dateRows.length === 1 &&
      units.length === 1 &&
      units[0].rowIndex === start - 1 &&
      dateRows[0].rowIndex === start - 2 &&
      headers
        .flatMap((r) => r.cells)
        .every(
          (c) =>
            !c.label ||
            amdLiteralDate(c.label) ||
            /^20\d{2}$/.test(c.label) ||
            /^(?:Year Ended|Three Months Ended|Six Months Ended|Nine Months Ended|\(In millions\))$/.test(
              c.label
            )
        ),
    "Changed original AMD date, duration or million-dollar headings"
  );
  const dates = dateRows[0].cells.filter((c) => c.label),
    amounts = total.cells.filter((c) => c.fact);
  demand(
    dates.length === primary.length && amounts.length === primary.length,
    "Incomplete original current/comparative/cumulative revenue columns"
  );
  const sectionLabels = rows
    .slice(start)
    .filter((r) => !r.cells.some((c) => c.fact))
    .map((r) => r.cells[0].label);
  demand(
    sectionLabels.every((l) => l === "Net revenue:" || l === "Client and Gaming" || !l) &&
      sectionLabels.filter((l) => l === "Client and Gaming").length <= 1 &&
      rows
        .slice(start)
        .filter((r) => !r.cells.some((c) => c.fact))
        .every((r) => r.cells.slice(1).every((c) => !c.label)),
    "Unaccounted original AMD business row"
  );
  demand(
    monetary.every(
      (r) =>
        !r.cells[0].fact &&
        r.cells.filter((c) => c.fact).length === amounts.length &&
        r.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label))
    ),
    "Missing or unaccounted original AMD monetary cell"
  );
  const used = new Set<string>();
  let selected:
    | {
        rows: ServiceRevenueRow[];
        cells: ServiceRevenueCell[];
        parent?: ServiceRevenueRow;
        profileId: string;
      }
    | undefined;
  let needsMda = false;
  for (const [i, c] of amounts.entries()) {
    const f = c.fact!,
      scope = amdFiscalScope(f.startDate, f.endDate),
      key = f.startDate + "|" + f.endDate;
    demand(!used.has(key), "Duplicate original AMD revenue scope");
    used.add(key);
    const anchor = primary.filter(
      (a) => a.scope.start === f.startDate && a.scope.end === f.endDate
    );
    demand(
      anchor.length === 1 &&
        inside(c, dates[i]) &&
        (amdLiteralDate(dates[i].label) === f.endDate ||
          (proof.originalFiscalPeriod === "FY" &&
            [2019, 2020].includes(proof.originalFiscalYear) &&
            dates[i].label === String(scope.year))),
      "Original business date column conflicts with the primary source"
    );
    const sourceBands = headers
      .flatMap((r) => r.cells)
      .filter((h) =>
        /^(?:Year Ended|Three Months Ended|Six Months Ended|Nine Months Ended)$/.test(h.label)
      );
    // These original annual tables print only dates or fiscal years. Their
    // original annual focus and independent dated primary establish duration.
    const annualDatesOnly =
      scope.kind === "annual" &&
      [2019, 2020, 2021].includes(proof.originalFiscalYear) &&
      proof.originalFiscalPeriod === "FY" &&
      sourceBands.length === 0;
    const durationLabel =
      scope.kind === "annual"
        ? "Year Ended"
        : scope.kind === "quarterly"
          ? "Three Months Ended"
          : scope.kind === "six-months"
            ? "Six Months Ended"
            : "Nine Months Ended";
    const bands = sourceBands.filter((h) => inside(dates[i], h));
    const shiftedQ1 =
      proof.originalFiscalPeriod === "Q1" &&
      proof.originalFiscalYear >= 2021 &&
      proof.originalFiscalYear <= 2026 &&
      sourceBands.length === 1 &&
      sourceBands[0].columnIndex === 9 &&
      sourceBands[0].span === 9 &&
      sourceBands[0].label === "Three Months Ended" &&
      dates[i].span === 3 &&
      [15, 21].includes(dates[i].columnIndex);
    const shifted2020Q2 =
      proof.originalFiscalYear === 2020 &&
      proof.originalFiscalPeriod === "Q2" &&
      scope.kind === "six-months" &&
      dates[i].columnIndex === 15 &&
      dates[i].span === 3 &&
      sourceBands.length === 2 &&
      sourceBands.some(
        (h) => h.columnIndex === 21 && h.span === 9 && h.label === "Six Months Ended"
      );
    demand(
      annualDatesOnly ||
        (bands.length === 1 && bands[0].label === durationLabel) ||
        shiftedQ1 ||
        shifted2020Q2,
      "Changed original business duration band"
    );
    const cells = monetary.map((r) => {
        const matches = r.cells.filter(
          (x) => x.fact?.startDate === f.startDate && x.fact.endDate === f.endDate
        );
        demand(
          matches.length === 1 && inside(matches[0], dates[i]) && matches[0].fact!.value >= 0,
          "Original AMD business amount, date or position changed"
        );
        return matches[0];
      }),
      classification = cells.map((x, j) => ({
        label: monetary[j].cells[0].label,
        tag: x.fact!.tag,
        dimensions: x.fact!.dimensions
      })),
      profiles = amdBusinessProfiles.filter(
        (pr) => canonicalAmdSource(pr.rows) === canonicalAmdSource(classification)
      );
    demand(profiles.length === 1, "Unknown original AMD business classification");
    const profile = profiles[0];
    if (profile.id === "amd-original-business-8" || profile.id === "amd-original-business-9")
      demand(
        proof.originalFiscalYear === 2022 &&
          proof.originalFiscalPeriod === "Q1" &&
          scope.year === (profile.id === "amd-original-business-8" ? 2022 : 2021),
        "Unreviewed acquired-Xilinx source scope"
      );
    needsMda ||= profile.requiresIndependentMda;
    const parent = profile.parent
      ? monetary.find((r) => r.cells[0].label === profile.parent!.label)
      : undefined;
    demand(
      !!parent === sectionLabels.includes("Client and Gaming"),
      "Changed original parent heading"
    );
    if (parent) {
      const j = monetary.indexOf(parent),
        children = profile.parent!.children.map((l) =>
          monetary.findIndex((r) => r.cells[0].label === l)
        );
      demand(
        children.every((k) => k >= 0 && k < j) &&
          children.reduce((n, k) => n + originalExactMillionDollars(cells[k]), 0n) ===
            originalExactMillionDollars(cells[j]),
        "Original Client and Gaming parent does not equal its children"
      );
    }
    const leaves = monetary.slice(0, -1).filter((r) => r !== parent),
      leafCells = leaves.map((r) => cells[monetary.indexOf(r)]);
    demand(
      leafCells.reduce((n, x) => n + originalExactMillionDollars(x), 0n) ===
        originalExactMillionDollars(c) &&
        originalExactMillionDollars(c) === originalExactMillionDollars(anchor[0].revenue),
      "Original complete businesses do not equal consolidated revenue"
    );
    if (key === p.startDate + "|" + p.endDate) {
      demand(
        !selected &&
          f.value === p.metrics.revenue &&
          p.metricSources.revenue?.method === "reported" &&
          p.metricSources.revenue.tag === f.tag &&
          p.metricSources.revenue.sourceUrl === p.sourceUrl &&
          p.metricSources.revenue.accession === p.accession &&
          p.metricSources.revenue.filedAt === p.filedAt,
        "Selected revenue differs from the preserved reported source"
      );
      if (p.metrics.incomeTax !== undefined)
        demand(
          p.metricSources.incomeTax?.method === "reported" &&
            p.metricSources.incomeTax.sourceUrl === p.sourceUrl &&
            p.metricSources.incomeTax.accession === p.accession &&
            p.metricSources.incomeTax.filedAt === p.filedAt &&
            p.metricSources.incomeTax.tag === anchor[0].tax.fact!.tag &&
            p.metrics.incomeTax === anchor[0].tax.fact!.value,
          "Selected tax differs from independent original primary"
        );
      selected = { rows: leaves, cells: leafCells, parent, profileId: profile.id };
    }
  }
  demand(
    used.size === primary.length &&
      primary.every((a) => used.has(a.scope.start + "|" + a.scope.end)) &&
      selected,
    "Incomplete original revenue periods or missing selected column"
  );
  demand(
    proof.classificationBasis ===
      (needsMda ? "original-row-captions-corroborated-by-mda" : "original-reported-scopes"),
    "Original classification conflict was omitted or invented"
  );
  if (needsMda) {
    demand(
      proof.independentMda &&
        integer(proof.independentMda.tableIndex) &&
        proof.independentMda.tableIndex !== proof.tableIndex &&
        proof.independentMda.tableIndex !== proof.primary.tableIndex,
      "Missing independent original MD&A table"
    );
    const mda = decodeOriginalRows(proof.independentMda.rows);
    originalReviewedMillionDollarRows(mda, proof.units, "0000002488");
    demand(
      mda.every((r) => r.cells.every((c) => !c.fact)) &&
        canonicalAmdSource(mda) === canonicalAmdSource(printedRows(rows)),
      "Independent complete MD&A labels, amounts, blanks or geometry changed"
    );
  } else demand(!proof.independentMda, "Unexpected original MD&A classification override");
  const s = selected,
    selectedTotal = amounts.find(
      (c) => c.fact!.startDate === p.startDate && c.fact!.endDate === p.endDate
    )!;
  const segments: RevenueSegment[] = s.rows.flatMap((r, i) => {
    const c = s.cells[i],
      f = c.fact!;
    if (!f.value) return [];
    return [
      {
        id: `reported-${r.cells[0].label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
        label: r.cells[0].label,
        revenue: f.value,
        revenueSource: {
          sourceUrl: p.sourceUrl,
          accession: p.accession!,
          filedAt: p.filedAt,
          startDate: p.startDate,
          endDate: p.endDate,
          currency: "USD",
          tag: f.tag,
          dimensions: f.dimensions,
          value: f.value,
          decimals: f.decimals,
          tableLabel: r.cells[0].label,
          rowLabel: r.cells[0].label,
          rowIndex: r.rowIndex,
          columnIndex: c.columnIndex
        }
      }
    ];
  });
  const describe = (r: ServiceRevenueRow, c: ServiceRevenueCell) => ({
    label: r.cells[0].label,
    tag: c.fact!.tag,
    dimensions: c.fact!.dimensions,
    value: c.fact!.value,
    decimals: c.fact!.decimals,
    rowIndex: r.rowIndex,
    columnIndex: c.columnIndex
  });
  return {
    segments,
    tableIndex: proof.tableIndex,
    totalDecimals: selectedTotal.fact!.decimals,
    totalLabel: "Total net revenue",
    omittedSubtotals: s.parent
      ? [
          describe(
            s.parent,
            s.parent.cells.find(
              (c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate
            )!
          )
        ]
      : [],
    omittedZeroColumns: s.rows.flatMap((r, i) =>
      s.cells[i].fact!.value === 0 ? [{ ...describe(r, s.cells[i]), value: 0 as const }] : []
    ),
    profileId: s.profileId
  };
}

export function amdRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.amdRevenue;
    demand(
      s?.method === "reviewed-amd-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.totalLabel === "Total net revenue" &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === amdRevenueBasis(proof),
      "Invalid original AMD business proof envelope"
    );
    demand(
      Object.keys(s).every((k) =>
        [
          "method",
          "ruleId",
          "tableIndex",
          "totalTableIndex",
          "sourceUrl",
          "accession",
          "revenueTag",
          "revenue",
          "revenueDecimals",
          "totalLabel",
          "omittedSubtotals",
          "omittedZeroColumns",
          "amdRevenue"
        ].includes(k)
      ),
      "Mixed or unsupported original AMD business proof"
    );
    const original = originalAmdRevenuePartition(p, proof);
    demand(
      s.tableIndex === original.tableIndex &&
        s.revenueDecimals === original.totalDecimals &&
        canonicalAmdSource(s.omittedSubtotals) === canonicalAmdSource(original.omittedSubtotals) &&
        canonicalAmdSource(s.omittedZeroColumns) ===
          canonicalAmdSource(original.omittedZeroColumns) &&
        canonicalAmdSource(p.segments) === canonicalAmdSource(original.segments),
      "Original AMD businesses or corroborating rows changed"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original AMD revenue proof";
  }
}
