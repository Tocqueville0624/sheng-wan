import type { ServiceRevenueCell, ServiceRevenueRow } from "./types";

/** Lossless original source coordinates. Compact only field names, never source
 * cells, empty spacers, monetary declarations, dates, dimensions or precision. */
export type OriginalCellTuple = [number, number, number, string, ServiceRevenueCell["fact"]?];
export type OriginalRowTuple = [number, OriginalCellTuple[]];
export const originalCellEncoding = "original-cell-tuples-v1";

function demand(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}

export function encodeOriginalRows(rows: ServiceRevenueRow[]): OriginalRowTuple[] {
  return rows.map((row) => {
    demand(
      Object.keys(row).every((key) => ["rowIndex", "cells"].includes(key)),
      "Unknown original row property cannot be discarded."
    );
    return [
      row.rowIndex,
      row.cells.map((cell): OriginalCellTuple => {
        demand(
          Object.keys(cell).every((key) =>
            ["columnIndex", "span", "rowSpan", "label", "fact"].includes(key)
          ),
          "Unknown original cell property cannot be discarded."
        );
        return cell.fact
          ? [cell.columnIndex, cell.span, cell.rowSpan, cell.label, cell.fact]
          : [cell.columnIndex, cell.span, cell.rowSpan, cell.label];
      })
    ];
  });
}

export function decodeOriginalRows(rows: OriginalRowTuple[]): ServiceRevenueRow[] {
  return decodeRows(rows, 64);
}

/** Finite BAC source geometry, including every hidden original spacer cell. */
export function decodeBacOriginalRows(rows: OriginalRowTuple[]): ServiceRevenueRow[] {
  return decodeRows(rows, 96);
}

function decodeRows(rows: OriginalRowTuple[], maxColumns: 64 | 96): ServiceRevenueRow[] {
  demand(Array.isArray(rows) && rows.length <= 200, "Invalid original row encoding.");
  return rows.map((row) => {
    demand(
      Array.isArray(row) &&
        row.length === 2 &&
        Number.isInteger(row[0]) &&
        row[0] >= 0 &&
        row[0] <= 200 &&
        Array.isArray(row[1]) &&
        row[1].length >= 1 &&
        row[1].length <= 64,
      "Invalid original physical row."
    );
    return {
      rowIndex: row[0],
      cells: row[1].map((cell) => {
        demand(
          Array.isArray(cell) &&
            [4, 5].includes(cell.length) &&
            [cell[0], cell[1], cell[2]].every(Number.isInteger) &&
            cell[0] >= 0 &&
            cell[0] <= maxColumns &&
            cell[1] >= 1 &&
            cell[1] <= 64 &&
            cell[0] + cell[1] <= maxColumns &&
            cell[2] >= 1 &&
            cell[2] <= 2 &&
            typeof cell[3] === "string" &&
            cell[3].length <= 250 &&
            (cell.length === 4 ||
              (!!cell[4] && typeof cell[4] === "object" && !Array.isArray(cell[4]))),
          "Invalid original physical cell."
        );
        return {
          columnIndex: cell[0],
          span: cell[1],
          rowSpan: cell[2],
          label: cell[3],
          ...(cell.length === 5 ? { fact: cell[4] } : {})
        };
      })
    };
  });
}
