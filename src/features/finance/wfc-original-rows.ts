import type { ServiceRevenueCell, ServiceRevenueRow } from "./types";
import { decodeOriginalRows } from "./original-cell-tuples";

type Context = [number, string, string, string, string, Record<string, string>];
type DeclarationProfile = [string, number, string, string, string, "-" | null];
type Definition = [string, number, number[]];
type Fact = [number, number, number, (number | null)[]];
type Cell = [number, number, string, number?];
export type WfcRowReferences = [number, [number, number][]];
export type WfcOriginalResources = {
  identifiers: [number, string][];
  contexts: Context[];
  profiles: DeclarationProfile[];
  definitions: Definition[];
  facts: Fact[];
  cells: Cell[];
};

function demand(v: unknown, reason: string): asserts v {
  if (!v) throw Error(reason);
}
const keys = (v: object, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );

/** Lossless dictionaries share repeated declarations and blank cell profiles.
 * Every original coordinate, span, label, value, context, sign and ID remains. */
export function packWfcOriginalRows(groups: ServiceRevenueRow[][]) {
  const resources: WfcOriginalResources = {
    identifiers: [],
    contexts: [],
    profiles: [],
    definitions: [],
    facts: [],
    cells: []
  };
  const identifiers = [
    ...new Set(
      groups.flatMap((group) =>
        group.flatMap((r) =>
          r.cells.flatMap((c) =>
            c.fact
              ? [
                  c.fact.contextId,
                  ...c.fact.declarations.flatMap((d) => (d.id !== undefined ? [d.id] : []))
                ]
              : []
          )
        )
      )
    )
  ].sort();
  const identifierMap = new Map(identifiers.map((id, i) => [id, i]));
  let previous = "";
  for (const id of identifiers) {
    let prefix = 0;
    while (prefix < id.length && prefix < previous.length && id[prefix] === previous[prefix])
      prefix++;
    resources.identifiers.push([prefix, id.slice(prefix)]);
    previous = id;
  }
  const maps = new Map<keyof WfcOriginalResources, Map<string, number>>();
  function intern<K extends keyof WfcOriginalResources>(
    kind: K,
    value: WfcOriginalResources[K][number]
  ) {
    const map = maps.get(kind) ?? new Map<string, number>();
    maps.set(kind, map);
    const key = canonical(value);
    if (!map.has(key)) {
      map.set(key, resources[kind].length);
      (resources[kind] as unknown[]).push(value);
    }
    return map.get(key)!;
  }
  const rows = groups.map((group) =>
    group.map((r): WfcRowReferences => {
      demand(keys(r, ["rowIndex", "cells"]), "Unknown WFC original row cannot be discarded");
      return [
        r.rowIndex,
        r.cells.map((c): [number, number] => {
          demand(
            keys(c, ["columnIndex", "span", "rowSpan", "label", "fact"]),
            "Unknown WFC original cell cannot be discarded"
          );
          const cell: Cell = [c.span, c.rowSpan, c.label];
          if (c.fact) {
            const f = c.fact;
            demand(
              keys(f, [
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
              ]),
              "Unknown WFC original fact cannot be discarded"
            );
            const context = intern("contexts", [
              identifierMap.get(f.contextId)!,
              f.cik,
              f.currency,
              f.startDate,
              f.endDate,
              f.dimensions
            ]);
            const profiles = f.declarations.map((d) => {
              demand(
                keys(d, [
                  "tag",
                  "contextId",
                  "unitRef",
                  "scale",
                  "decimals",
                  "originalScale",
                  "format",
                  "sign",
                  "id"
                ]) &&
                  d.tag === f.tag &&
                  d.contextId === f.contextId &&
                  typeof d.decimals === "string" &&
                  typeof d.originalScale === "string",
                "Unknown or conflicting WFC original declaration cannot be discarded"
              );
              return intern("profiles", [
                d.unitRef,
                d.scale,
                d.decimals,
                d.originalScale,
                d.format,
                d.sign ?? null
              ]);
            });
            const definition = intern("definitions", [f.tag, f.decimals, profiles]);
            cell.push(
              intern("facts", [
                definition,
                context,
                f.value,
                f.declarations.map((d) => (d.id !== undefined ? identifierMap.get(d.id)! : null))
              ])
            );
          }
          return [c.columnIndex, intern("cells", cell)];
        })
      ];
    })
  );
  return { rows, resources };
}

/** Decode one complete source set, rejecting unused/altered dictionary entries. */
export function decodeWfcOriginalRows(
  groups: WfcRowReferences[][],
  resources: WfcOriginalResources
): ServiceRevenueRow[][] {
  demand(
    resources &&
      keys(resources, ["identifiers", "contexts", "profiles", "definitions", "facts", "cells"]),
    "Unknown WFC source dictionary"
  );
  for (const [key, limit] of [
    ["identifiers", 3200],
    ["contexts", 320],
    ["profiles", 32],
    ["definitions", 200],
    ["facts", 1200],
    ["cells", 3000]
  ] as const)
    demand(
      Array.isArray(resources[key]) && resources[key].length > 0 && resources[key].length <= limit,
      "Invalid WFC original dictionary bounds"
    );
  const ref = (n: number, array: unknown[]) => Number.isInteger(n) && n >= 0 && n < array.length;
  let previous = "",
    decodedBytes = 0;
  const identifiers = resources.identifiers.map((t, i) => {
    demand(
      Array.isArray(t) &&
        t.length === 2 &&
        Number.isInteger(t[0]) &&
        t[0] >= 0 &&
        t[0] <= previous.length &&
        typeof t[1] === "string" &&
        t[1].length <= 2048 &&
        (i > 0 || t[0] === 0),
      "Invalid WFC original identifier prefix"
    );
    const value = previous.slice(0, t[0]) + t[1];
    demand(
      value.length <= 2048 && (i === 0 || value > previous),
      "Duplicate or unordered WFC original identifier"
    );
    decodedBytes += value.length;
    demand(decodedBytes <= 1000000, "Oversized WFC original identifier dictionary");
    previous = value;
    return value;
  });
  const facts: NonNullable<ServiceRevenueCell["fact"]>[] = resources.facts.map((t) => {
    demand(
      Array.isArray(t) &&
        t.length === 4 &&
        ref(t[0], resources.definitions) &&
        ref(t[1], resources.contexts) &&
        Number.isFinite(t[2]) &&
        Array.isArray(t[3]) &&
        t[3].length >= 1 &&
        t[3].length <= 2,
      "Invalid WFC original fact reference"
    );
    const definition = resources.definitions[t[0]],
      context = resources.contexts[t[1]];
    demand(
      Array.isArray(definition) &&
        definition.length === 3 &&
        typeof definition[0] === "string" &&
        definition[1] === -6 &&
        Array.isArray(definition[2]) &&
        definition[2].length === t[3].length,
      "Invalid WFC original monetary definition"
    );
    demand(
      Array.isArray(context) &&
        context.length === 6 &&
        ref(context[0], identifiers) &&
        context.slice(1, 5).every((s) => typeof s === "string") &&
        context[1] === "0000072971" &&
        context[2] === "USD" &&
        context[5] &&
        typeof context[5] === "object" &&
        !Array.isArray(context[5]),
      "Invalid WFC original context reference"
    );
    return {
      tag: definition[0],
      value: t[2],
      decimals: definition[1],
      contextId: identifiers[context[0]],
      cik: context[1],
      currency: "USD",
      startDate: context[3],
      endDate: context[4],
      dimensions: context[5],
      declarations: definition[2].map((n, i) => {
        demand(ref(n, resources.profiles), "Missing WFC original declaration profile");
        const p = resources.profiles[n],
          id = t[3][i];
        demand(
          Array.isArray(p) &&
            p.length === 6 &&
            typeof p[0] === "string" &&
            p[1] === 6 &&
            p[2] === "-6" &&
            p[3] === "6" &&
            typeof p[4] === "string" &&
            (p[5] === null || p[5] === "-") &&
            (id === null || ref(id, identifiers)),
          "Invalid WFC original monetary declaration"
        );
        return {
          tag: definition[0],
          contextId: identifiers[context[0]],
          unitRef: p[0],
          scale: 6,
          decimals: p[2],
          originalScale: p[3],
          format: p[4],
          ...(p[5] ? { sign: p[5] } : {}),
          ...(id !== null ? { id: identifiers[id] } : {})
        };
      })
    };
  });
  demand(
    Array.isArray(groups) && groups.length >= 1 && groups.length <= 5,
    "Invalid WFC original region count"
  );
  const rows = groups.map((group) => {
    demand(
      Array.isArray(group) && group.length >= 1 && group.length <= 200,
      "Invalid WFC original row count"
    );
    return decodeOriginalRows(
      group.map((r) => {
        demand(
          Array.isArray(r) && r.length === 2 && Array.isArray(r[1]),
          "Invalid WFC original row reference"
        );
        return [
          r[0],
          r[1].map((c) => {
            demand(
              Array.isArray(c) &&
                c.length === 2 &&
                Number.isInteger(c[0]) &&
                ref(c[1], resources.cells),
              "Invalid WFC original cell reference"
            );
            const p = resources.cells[c[1]];
            demand(
              Array.isArray(p) &&
                [3, 4].includes(p.length) &&
                (p.length === 3 || ref(p[3]!, facts)),
              "Invalid WFC original cell profile"
            );
            return p.length === 3
              ? [c[0], p[0], p[1], p[2]]
              : [c[0], p[0], p[1], p[2], facts[p[3]!]];
          })
        ];
      })
    );
  });
  const packed = packWfcOriginalRows(rows);
  demand(
    canonical(packed.resources) === canonical(resources) &&
      canonical(packed.rows) === canonical(groups),
    "Unused, reordered or altered WFC original dictionary resources"
  );
  return rows;
}
