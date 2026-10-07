import type { ServiceRevenueRow, ServiceRevenueRowsProof } from "./types";

export class OriginalRevenueRowsError extends Error {}
function demand(v: unknown, reason: string): asserts v {
  if (!v) throw new OriginalRevenueRowsError(reason);
}
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const integer = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;

/** Validate unchanged physical source cells and their original USD thousand-scale
 * declarations. The calling issuer proof separately establishes business meanings,
 * dates, complete columns and independently reported consolidated totals. */
export function originalThousandDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"],
  cik: string
) {
  return originalDollarRows(rows, units, cik, 3);
}

/** Million-dollar declarations are supported only through a separately reviewed
 * caller. The original thousand-dollar contract remains unchanged. */
export function originalMillionDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"],
  cik: string
) {
  return originalDollarRows(rows, units, cik, 6);
}

/** Display scale and declared precision are independent. Only a finite issuer
 * profile may use this reader; the original declarations and parsed values are
 * retained, including binary floating-point representations of exact dollars. */
export function originalReviewedMillionDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"],
  cik: string
) {
  return originalDollarRows(rows, units, cik, 6, [-5, -6]);
}

/** BAC's reviewed 66-column matrices retain hidden original spacers. */
export function originalBacMillionDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"]
) {
  return originalDollarRows(rows, units, "0000070858", 6, [-6], 96);
}

/** JPM's reviewed original matrices preserve all hidden physical spacer cells. */
export function originalJpmMillionDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"]
) {
  return originalDollarRows(rows, units, "0000019617", 6, [-6], 96);
}

/** Independently replay an original decimal display as exact integer dollars.
 * This value is for reconciliation only, never a replacement for reported facts. */
export function originalExactMillionDollars(c: ServiceRevenueRow["cells"][number]): bigint {
  demand(c.fact && c.fact.declarations.length > 0, "Missing original amount");
  const d = c.fact.declarations[0];
  const lexical = c.label.replace(/[,\s$]/g, "").replace(/^[(-]|\)$/g, "");
  if (/^ixt:(?:zerodash|fixed-zero)$/.test(d.format)) {
    demand(/^[—–-]$/.test(lexical) && c.fact.value === 0, "Invalid original zero");
    return 0n;
  }
  demand(/^\d+(?:\.\d{1,6})?$/.test(lexical), "Invalid original decimal amount");
  const [whole, fraction = ""] = lexical.split(".");
  const exact = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  demand(Number.isSafeInteger(Number(exact)), "Unsafe original dollar amount");
  return d.sign === "-" ? -exact : exact;
}

function originalDollarRows(
  rows: ServiceRevenueRow[],
  units: ServiceRevenueRowsProof["units"],
  cik: string,
  scale: 3 | 6,
  reviewedDecimals: readonly number[] = [-scale],
  maxColumns: 64 | 96 = 64
) {
  demand(/^\d{10}$/.test(cik) && Number(cik) > 0, "Invalid original issuer identity");
  const occupied = new Set<string>();
  let prior = -1;
  for (const row of rows) {
    demand(
      integer(row.rowIndex, 200) &&
        row.rowIndex > prior &&
        Array.isArray(row.cells) &&
        row.cells.length >= 1 &&
        row.cells.length <= 64,
      "Invalid original revenue rows"
    );
    prior = row.rowIndex;
    let column = 0;
    for (const c of row.cells) {
      while (occupied.has(`${row.rowIndex}:${column}`)) column++;
      demand(
        integer(c.columnIndex, maxColumns) &&
          c.columnIndex === column &&
          integer(c.span, 64) &&
          c.span >= 1 &&
          integer(c.rowSpan, 2) &&
          c.rowSpan >= 1 &&
          (!c.fact || c.rowSpan === 1) &&
          typeof c.label === "string" &&
          c.label.length <= 250,
        "Invalid original physical cell"
      );
      for (let y = 0; y < c.rowSpan; y++)
        for (let x = 0; x < c.span; x++) {
          const k = `${row.rowIndex + y}:${column + x}`;
          demand(!occupied.has(k), "Overlapping source cells");
          occupied.add(k);
        }
      column += c.span;
      demand(column <= maxColumns, "Oversized original row");
      if (!c.fact) continue;
      const f = c.fact,
        d = f.declarations?.[0];
      demand(
        f.currency === "USD" &&
          Number(f.cik) === Number(cik) &&
          f.contextId &&
          date(f.startDate) &&
          date(f.endDate) &&
          f.startDate < f.endDate &&
          f.dimensions &&
          (reviewedDecimals.length === 1
            ? Number.isSafeInteger(f.value)
            : Number.isFinite(f.value) && Number.isSafeInteger(Math.round(f.value))) &&
          reviewedDecimals.includes(f.decimals) &&
          !f.corroboratingContexts?.length &&
          d &&
          Array.isArray(f.declarations) &&
          f.declarations.length >= 1 &&
          f.declarations.length <= 2 &&
          f.declarations.every(
            (x) =>
              x.tag === f.tag &&
              x.contextId === f.contextId &&
              x.unitRef === d.unitRef &&
              x.scale === scale &&
              x.decimals === String(f.decimals) &&
              x.originalScale === String(scale) &&
              x.format === d.format &&
              x.sign === d.sign
          ) &&
          units.some((u) => u.id === d.unitRef && u.measure === "iso4217:USD") &&
          /^(?:ixt:(?:numdotdecimal|num-dot-decimal|zerodash|fixed-zero))?$/.test(d.format) &&
          (d.sign === undefined || d.sign === "-"),
        "Invalid original monetary proof"
      );
      const lexical = c.label.replace(/[,\s$]/g, "").replace(/^[(-]|\)$/g, "");
      const zero = /^ixt:(?:zerodash|fixed-zero)$/.test(d.format);
      demand(
        zero
          ? /^[—–-]$/.test(lexical) && f.value === 0 && d.sign === undefined
          : /^\d+(?:\.\d+)?$/.test(lexical) &&
              Number(lexical) * 10 ** scale === Math.abs(f.value) &&
              (d.sign === "-") === f.value < 0,
        "Displayed revenue differs from the original fact"
      );
      if (reviewedDecimals.length > 1) {
        const exact = Number(originalExactMillionDollars(c));
        demand(
          Math.abs(exact - f.value) <= Math.max(0.000001, Math.abs(exact) * Number.EPSILON),
          "Parsed amount differs from exact original dollars"
        );
      }
    }
  }
}
