import type { ServiceRevenueRow, ServiceRevenueRowsProof } from "../../src/features/finance/types";
import { attribute, factKey, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";

export class InvalidRevenueGrid extends Error {}
const demand = (value: unknown, reason: string): void => {
  if (!value) throw new InvalidRevenueGrid(reason);
};

/** Read the actual physical cells and numeric declarations. A parsed fact alone
 * cannot replace the visible original amount or its source coordinates. */
export function originalRevenueGrid(html: string, parsed: ParsedFiling, cik: string) {
  const units: ServiceRevenueRowsProof["units"] = [];
  for (const [unit] of html.matchAll(/<(?:[\w.-]+:)?unit\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?unit>/gi)) {
    if (/<(?:[\w.-]+:)?divide\b/i.test(unit)) continue;
    const measures = [
      ...unit.matchAll(/<(?:[\w.-]+:)?measure\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?measure>/gi)
    ];
    const id = attribute(unit.match(/^<[^>]*>/)![0], "id");
    if (id && measures.length === 1 && measures[0][1] === "iso4217:USD")
      units.push({ id, measure: "iso4217:USD" });
  }
  const refs = new Map<string, XbrlFact[]>(),
    groups = new Map<string, XbrlFact[]>();
  const scope = (f: XbrlFact) => `${f.context.start}|${f.context.end}|${f.currency}|${factKey(f)}`;
  for (const f of parsed.facts) {
    const key = f.tag + "|" + f.context.id;
    refs.set(key, [...(refs.get(key) ?? []), f]);
    const k = scope(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const grid = (table: string, selectedRows: Set<number>): ServiceRevenueRow[] => {
    demand(
      table.length <= 512000 && !/<table\b/i.test(table.slice(table.indexOf(">") + 1)),
      "Oversized or nested original table"
    );
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    demand(rows.length <= 200, "Too many original rows");
    const occupied = new Set<string>();
    return rows.flatMap(([row], rowIndex) => {
      if (!selectedRows.has(rowIndex)) return [];
      let columnIndex = 0;
      const cells = [...row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map(
        ([raw]) => {
          while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex++;
          const opening = raw.match(/^<[^>]*>/)![0],
            span = Number(attribute(opening, "colspan") ?? 1),
            rowSpan = Number(attribute(opening, "rowspan") ?? 1);
          demand(
            Number.isInteger(span) &&
              span >= 1 &&
              span <= 64 &&
              Number.isInteger(rowSpan) &&
              rowSpan >= 1 &&
              rowSpan <= 2 &&
              columnIndex + span <= 64,
            "Invalid original cell span"
          );
          const c: ServiceRevenueRow["cells"][number] = {
            columnIndex,
            span,
            rowSpan,
            label: visibleText(raw)
          };
          for (let y = 0; y < rowSpan; y++)
            for (let x = 0; x < span; x++) {
              const key = `${rowIndex + y}:${columnIndex + x}`;
              demand(!occupied.has(key), "Overlapping original cells");
              occupied.add(key);
            }
          columnIndex += span;
          const declarations = [...raw.matchAll(/<ix:nonFraction\b[^>]*>/gi)];
          if (!declarations.length) return c;
          demand(
            rowSpan === 1 && declarations.length <= 2,
            "Invalid original monetary declarations"
          );
          const d = declarations[0][0],
            tag = attribute(d, "name"),
            contextId = attribute(d, "contextRef"),
            unitRef = attribute(d, "unitRef"),
            format = attribute(d, "format") ?? "",
            sign = attribute(d, "sign");
          demand(
            tag &&
              contextId &&
              unitRef &&
              units.some((u) => u.id === unitRef) &&
              Number(attribute(d, "scale")) === 3 &&
              Number(attribute(d, "decimals")) === -3 &&
              /^(?:ixt:(?:numdotdecimal|num-dot-decimal|zerodash|fixed-zero))?$/.test(format) &&
              (sign === undefined || sign === "-"),
            "Unreviewed monetary declaration"
          );
          demand(
            declarations.every(([x]) =>
              ["name", "contextRef", "unitRef", "scale", "decimals", "format", "sign"].every(
                (k) => attribute(x, k) === attribute(d, k)
              )
            ),
            "Conflicting nested monetary declarations"
          );
          const body = raw.match(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/i)?.[0];
          demand(body, "Missing numeric body");
          const rawLexical = visibleText(body!);
          demand(format || !rawLexical.includes(","), "Untransformed number is not an XML decimal");
          const lexical = rawLexical.replaceAll(",", "");
          const zero = /^ixt:(?:zerodash|fixed-zero)$/.test(format!);
          demand(
            zero ? /^[—–-]$/.test(lexical) : /^\d+(?:\.\d+)?$/.test(lexical),
            "Invalid original displayed amount"
          );
          const amount = (zero ? 0 : Number(lexical) * 1000) * (sign === "-" ? -1 : 1);
          const f = refs
            .get(tag + "|" + contextId)
            ?.find((f) => f.value === amount && f.decimals === -3);
          demand(
            f &&
              f.currency === "USD" &&
              !f.context.typed &&
              f.context.start &&
              f.context.end &&
              Number(f.context.cik) === Number(cik) &&
              precise(groups.get(scope(f)) ?? []),
            "Missing or conflicting original fact"
          );
          c.fact = {
            tag: f!.tag,
            value: f!.value,
            decimals: f!.decimals,
            contextId: f!.context.id,
            cik: f!.context.cik,
            currency: "USD",
            startDate: f!.context.start!,
            endDate: f!.context.end!,
            dimensions: f!.context.dimensions,
            declarations: declarations.map(([x]) => ({
              tag: tag!,
              contextId: contextId!,
              unitRef: unitRef!,
              scale: 3,
              decimals: attribute(x, "decimals")!,
              originalScale: attribute(x, "scale")!,
              format,
              ...(sign ? { sign: sign as "-" } : {}),
              ...(attribute(x, "id") ? { id: attribute(x, "id")! } : {})
            }))
          };
          return c;
        }
      );
      demand(cells.length >= 1, "Empty original physical row");
      return [{ rowIndex, cells }];
    });
  };
  return { units, grid };
}
