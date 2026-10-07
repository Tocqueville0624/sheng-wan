import type { ServiceRevenueRow } from "./types";
import type { OriginalInstance } from "../../../scripts/finance/standalone-xbrl";
import { originalThousandDollarRows } from "./original-revenue-rows";

export class OriginalStandaloneRevenueJoinError extends Error {}
function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new OriginalStandaloneRevenueJoinError(reason);
}
/** A reviewed original table layout, never financial amounts. This preparation
 * contract does not establish complete business classification or chart coverage. */
export type OriginalStandaloneTableSelection = {
  tableIndex: number;
  units: { rowIndex: number; label: string } | { precedingTextSuffix: string };
  headers: { rowIndex: number; labels: string[]; selectedIndex: number; prefixLabel?: string };
  calendarYear: number;
  yearHeader?: { rowIndex: number; label: string };
  period: { startDate: string; endDate: string };
  rows: {
    rowIndex: number;
    label: string;
    selectedColumn?: number;
    /** Complete physical monetary column ranges, in original display order.
     * These remain explicit because old HTML headers/spacers can differ by row. */
    columns: { columnIndex: number; span: number }[];
    tag: string;
    dimensions: Record<string, string>;
    /** Some expense-layout gain/minority lines visibly subtract a positive fact.
     * Keep both original signs; no reversal is applied to the XML amount. */
    displayPolarity?: "same" | "opposite";
  }[];
};
const sameDimensions = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v);
const thousandUnits = new Set([
  "(In thousands)",
  "(In Thousands, Except Per Share Amounts)",
  "(In thousands, except per share amounts)"
]);

/** Replay the original physical positions, visible amounts and scoped XML facts.
 * This browser/Worker-compatible validator contains no acquisition or storage code.
 * The issuer proof must separately bind source documents and business meanings. */
export function replayOriginalStandaloneRevenueTable(
  source: { cik: string; instance: OriginalInstance },
  table: { tableIndex: number; rows: ServiceRevenueRow[]; precedingText: string },
  selection: OriginalStandaloneTableSelection
) {
  demand(
    table.tableIndex === selection.tableIndex &&
      Number.isInteger(table.tableIndex) &&
      table.tableIndex >= 0 &&
      table.tableIndex <= 5000,
    "Changed original table identity."
  );
  demand(
    table.rows.length >= 1 &&
      table.rows.length <= 200 &&
      table.rows.every((r, i) => r.rowIndex === i && r.cells.every((c) => !c.fact)),
    "Standalone physical rows cannot contain synthetic inline facts or omitted rows."
  );
  originalThousandDollarRows(table.rows, [], source.cik);
  demand(
    typeof table.precedingText === "string" && table.precedingText.length <= 16000,
    "Invalid original preceding table text."
  );
  const rows = table.rows;
  const header = rows.find((r) => r.rowIndex === selection.headers.rowIndex);
  demand(
    header &&
      Number.isInteger(selection.headers.selectedIndex) &&
      selection.headers.selectedIndex >= 0 &&
      selection.headers.selectedIndex < selection.headers.labels.length &&
      JSON.stringify(header.cells.filter((c) => c.label).map((c) => c.label)) ===
        JSON.stringify([
          ...(selection.headers.prefixLabel ? [selection.headers.prefixLabel] : []),
          ...selection.headers.labels
        ]),
    "Changed original temporal or business column headers."
  );
  demand(
    Number.isInteger(selection.calendarYear) &&
      selection.calendarYear >= 2009 &&
      selection.period.startDate === `${selection.calendarYear}-01-01` &&
      selection.period.endDate === `${selection.calendarYear}-12-31`,
    "Unreviewed original calendar-year period."
  );
  const selectedHeader = selection.headers.labels[selection.headers.selectedIndex];
  if (/^\d{4}$/.test(selectedHeader)) {
    demand(
      selectedHeader === String(selection.calendarYear),
      "Original year column differs from selected XML period."
    );
  } else {
    const anchor = selection.yearHeader;
    demand(
      anchor &&
        anchor.label === String(selection.calendarYear) &&
        rows
          .find((r) => r.rowIndex === anchor.rowIndex)
          ?.cells.filter((c) => c.label)
          .map((c) => c.label)
          .join("") === anchor.label,
      "Missing original annual year anchor for business columns."
    );
  }
  const originalUnits = selection.units;
  if ("rowIndex" in originalUnits) {
    const unitRow = rows.find((r) => r.rowIndex === originalUnits.rowIndex);
    demand(
      thousandUnits.has(originalUnits.label) &&
        unitRow &&
        unitRow.cells.filter((c) => c.label).length === 1 &&
        unitRow.cells.find((c) => c.label)?.label === originalUnits.label,
      "Missing original thousand-dollar table units."
    );
  } else {
    const suffix = originalUnits.precedingTextSuffix;
    demand(
      [...thousandUnits].some((u) => suffix.endsWith(u)) && table.precedingText.endsWith(suffix),
      "Missing original preceding statement heading and units."
    );
  }
  const selectedRows = new Set<string>();
  const monetaryRows = selection.rows.map((binding) => {
    const column = binding.selectedColumn ?? selection.headers.selectedIndex;
    demand(
      Number.isInteger(column) && column >= 0 && column < selection.headers.labels.length,
      "Invalid original selected monetary column."
    );
    const headerLabel = selection.headers.labels[column];
    demand(
      !/^\d{4}$/.test(headerLabel) || headerLabel === String(selection.calendarYear),
      "Original selected year differs from XML period."
    );
    const selectedKey = `${binding.rowIndex}:${column}`;
    const row = rows.find((r) => r.rowIndex === binding.rowIndex);
    demand(
      row &&
        !selectedRows.has(selectedKey) &&
        row.cells[0]?.label === binding.label &&
        binding.columns.length === selection.headers.labels.length,
      "Changed original monetary row or column count."
    );
    selectedRows.add(selectedKey);
    let priorEnd = row.cells[0].columnIndex + row.cells[0].span;
    const covered = new Set<number>();
    const groups = binding.columns.map((range) => {
      demand(
        Number.isInteger(range.columnIndex) &&
          Number.isInteger(range.span) &&
          range.span >= 1 &&
          range.columnIndex >= priorEnd &&
          range.columnIndex + range.span <= 64,
        "Invalid original monetary column ranges."
      );
      priorEnd = range.columnIndex + range.span;
      const cells = row.cells.filter(
        (c) => c.columnIndex >= range.columnIndex && c.columnIndex + c.span <= priorEnd
      );
      demand(
        cells.length > 0 &&
          cells.reduce((n, c) => n + c.span, 0) === range.span &&
          cells.every((c) => c.rowSpan === 1),
        "Incomplete original monetary physical column."
      );
      cells.forEach((c) => covered.add(c.columnIndex));
      const lexical = cells.map((c) => c.label).join("");
      if (/^\$?[—–-]$/.test(lexical)) return { cells, lexical, value: undefined };
      demand(
        /^\$?\(?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\)?$/.test(lexical) &&
          lexical.includes("(") === lexical.endsWith(")"),
        "Unreviewed or missing original displayed amount."
      );
      const value =
        Number(lexical.replace(/[$(),]/g, "")) * 1000 * (lexical.includes("(") ? -1 : 1);
      demand(Number.isSafeInteger(value), "Unsafe original displayed monetary amount.");
      return { cells, lexical, value };
    });
    demand(
      row.cells.every((c, i) => i === 0 || !c.label || covered.has(c.columnIndex)),
      "Unaccounted original monetary row content."
    );
    const selected = groups[column];
    demand(selected.value !== undefined, "Selected original period has no disclosed amount.");
    const matches = source.instance.facts.filter(
      (f) =>
        f.tag === binding.tag &&
        f.currency === "USD" &&
        Number(f.context.cik) === Number(source.cik) &&
        !f.context.typed &&
        !f.context.unreviewedScope &&
        f.context.start === selection.period.startDate &&
        f.context.end === selection.period.endDate &&
        sameDimensions(f.context.dimensions, binding.dimensions)
    );
    demand(
      !source.instance.nilFacts.some(
        (f) =>
          f.tag === binding.tag &&
          Number(f.context.cik) === Number(source.cik) &&
          f.context.start === selection.period.startDate &&
          f.context.end === selection.period.endDate &&
          sameDimensions(f.context.dimensions, binding.dimensions)
      ),
      "Conflicting original nil declaration in selected scope."
    );
    // Select by exact concept/date/classification first; only then compare the
    // visible value. Equal values never choose between differing precision copies.
    demand(matches.length === 1, "Missing or ambiguous original scoped XML declaration.");
    const fact = matches[0],
      polarity = binding.displayPolarity ?? "same";
    demand(
      fact.decimals === -3 && fact.value === selected.value * (polarity === "opposite" ? -1 : 1),
      "Original visible amount, sign or precision differs from its XML declaration."
    );
    return {
      rowIndex: binding.rowIndex,
      selectedColumn: column,
      label: binding.label,
      originalCells: selected.cells,
      displayLexical: selected.lexical,
      displayedWholeDollarValue: selected.value,
      displayPolarity: polarity,
      originalFact: fact
    };
  });
  demand(monetaryRows.length > 0, "No original monetary rows selected.");

  return {
    tableIndex: selection.tableIndex,
    rows,
    precedingText: table.precedingText,
    selection,
    units: selection.units,
    header,
    selectedColumn: selection.headers.selectedIndex,
    monetaryRows
  };
}
