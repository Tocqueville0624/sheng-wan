import type { BacOriginalResources, BacRowTuple } from "./bac-types";
import type { ServiceRevenueRow, ServiceRevenueCell } from "./types";
import { decodeBacOriginalRows } from "./original-cell-tuples";

function demand(v: unknown, reason: string): asserts v {
  if (!v) throw Error(reason);
}

/** Dictionary references remove duplicate field names and context descriptions;
 * all original cell coordinates, blanks, declarations, signs and IDs round-trip. */
export function packBacOriginalRows(groups: ServiceRevenueRow[][]) {
  const resources: BacOriginalResources = { contexts: [], facts: [] },
    contexts = new Map<string, number>(),
    facts = new Map<string, number>();
  const rows = groups.map((group) =>
    group.map((r): BacRowTuple => [
      r.rowIndex,
      r.cells.map((c) => {
        demand(
          Object.keys(r).every((k) => ["rowIndex", "cells"].includes(k)) &&
            Object.keys(c).every((k) =>
              ["columnIndex", "span", "rowSpan", "label", "fact"].includes(k)
            ),
          "Unknown BAC source cell cannot be discarded"
        );
        if (!c.fact) return [c.columnIndex, c.span, c.rowSpan, c.label];
        const f = c.fact;
        demand(
          Object.keys(f).every((k) =>
            [
              "tag",
              "value",
              "decimals",
              "contextId",
              "cik",
              "currency",
              "startDate",
              "endDate",
              "dimensions",
              "declarations"
            ].includes(k)
          ),
          "Unknown BAC source fact cannot be discarded"
        );
        const context: BacOriginalResources["contexts"][number] = [
            f.contextId,
            f.cik,
            f.currency,
            f.startDate,
            f.endDate,
            f.dimensions
          ],
          contextKey = JSON.stringify(context);
        if (!contexts.has(contextKey)) {
          contexts.set(contextKey, resources.contexts.length);
          resources.contexts.push(context);
        }
        const declarations: BacOriginalResources["facts"][number][4] = f.declarations.map((d) => {
          demand(
            d.tag === f.tag &&
              d.contextId === f.contextId &&
              typeof d.decimals === "string" &&
              typeof d.originalScale === "string" &&
              Object.keys(d).every((k) =>
                [
                  "tag",
                  "contextId",
                  "unitRef",
                  "scale",
                  "decimals",
                  "originalScale",
                  "format",
                  "sign",
                  "id"
                ].includes(k)
              ),
            "Unknown or conflicting BAC declaration cannot be discarded"
          );
          return [
            d.unitRef,
            d.scale,
            d.decimals,
            d.originalScale,
            d.format,
            d.sign ?? null,
            d.id ?? null
          ];
        });
        const fact: BacOriginalResources["facts"][number] = [
            f.tag,
            f.value,
            f.decimals,
            contexts.get(contextKey)!,
            declarations
          ],
          factKey = JSON.stringify(fact);
        if (!facts.has(factKey)) {
          facts.set(factKey, resources.facts.length);
          resources.facts.push(fact);
        }
        return [c.columnIndex, c.span, c.rowSpan, c.label, facts.get(factKey)!];
      })
    ])
  );
  return { rows, resources };
}

export function decodeBacRows(
  rows: BacRowTuple[],
  resources: BacOriginalResources
): ServiceRevenueRow[] {
  demand(
    resources &&
      Object.keys(resources).every((k) => ["contexts", "facts"].includes(k)) &&
      Array.isArray(resources.contexts) &&
      resources.contexts.length > 0 &&
      resources.contexts.length <= 200 &&
      Array.isArray(resources.facts) &&
      resources.facts.length > 0 &&
      resources.facts.length <= 600,
    "Invalid original BAC resource dictionaries"
  );
  const facts: NonNullable<ServiceRevenueCell["fact"]>[] = resources.facts.map((t) => {
    demand(
      Array.isArray(t) &&
        t.length === 5 &&
        typeof t[0] === "string" &&
        Number.isFinite(t[1]) &&
        Number.isInteger(t[2]) &&
        Number.isInteger(t[3]) &&
        t[3] >= 0 &&
        t[3] < resources.contexts.length &&
        Array.isArray(t[4]) &&
        t[4].length >= 1 &&
        t[4].length <= 2,
      "Invalid unchanged BAC fact tuple"
    );
    const c = resources.contexts[t[3]];
    demand(
      Array.isArray(c) &&
        c.length === 6 &&
        c.slice(0, 5).every((s) => typeof s === "string") &&
        c[2] === "USD" &&
        c[5] &&
        typeof c[5] === "object" &&
        !Array.isArray(c[5]),
      "Invalid unchanged BAC context tuple"
    );
    return {
      tag: t[0],
      value: t[1],
      decimals: t[2],
      contextId: c[0],
      cik: c[1],
      currency: "USD",
      startDate: c[3],
      endDate: c[4],
      dimensions: c[5],
      declarations: t[4].map((d) => {
        demand(
          Array.isArray(d) &&
            d.length === 7 &&
            typeof d[0] === "string" &&
            Number.isInteger(d[1]) &&
            [d[2], d[3], d[4]].every((s) => typeof s === "string") &&
            (d[5] === null || d[5] === "-") &&
            (d[6] === null || typeof d[6] === "string"),
          "Invalid unchanged BAC declaration tuple"
        );
        return {
          tag: t[0],
          contextId: c[0],
          unitRef: d[0],
          scale: d[1] as 3 | 6,
          decimals: d[2],
          originalScale: d[3],
          format: d[4],
          ...(d[5] ? { sign: d[5] } : {}),
          ...(d[6] !== null ? { id: d[6] } : {})
        };
      })
    };
  });
  demand(Array.isArray(rows) && rows.length <= 200, "Invalid original BAC row references");
  return decodeBacOriginalRows(
    rows.map((r) => {
      demand(
        Array.isArray(r) && r.length === 2 && Array.isArray(r[1]),
        "Invalid original BAC physical row reference"
      );
      return [
        r[0],
        r[1].map((c) => {
          demand(
            Array.isArray(c) &&
              [4, 5].includes(c.length) &&
              (c.length === 4 || (Number.isInteger(c[4]) && c[4]! >= 0 && c[4]! < facts.length)),
            "Invalid original BAC monetary reference"
          );
          return c.length === 4 ? [c[0], c[1], c[2], c[3]] : [c[0], c[1], c[2], c[3], facts[c[4]!]];
        })
      ];
    })
  );
}
