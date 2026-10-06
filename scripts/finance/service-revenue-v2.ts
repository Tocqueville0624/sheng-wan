import type {
  ServiceRevenueCell,
  ServiceRevenueRow,
  ServiceRevenueRowsProof
} from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  akamaiServiceProfiles,
  serviceRevenueBasis,
  serviceRevenueSegments,
  ServiceRevenueProofError
} from "../../src/features/finance/service-revenue-rows";
import { attribute, factKey, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

class InvalidServiceSource extends Error {}
function demand(
  value: unknown,
  reason = "Incomplete original service-revenue source"
): asserts value {
  if (!value) throw new InvalidServiceSource(reason);
}

/** Preserve the physical original cells, including comparative and YTD columns.
 * A finite issuer rule validates the complete table instead of enabling channel
 * axes globally or choosing a subset whose amounts happen to add up.
 */
export function enrichServiceRevenuePeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling,
  onWithheld?: (diagnostic: {
    id?: string;
    tableIndex: number;
    reason: string;
    proof?: ServiceRevenueRowsProof;
  }) => void
): PeriodV2[] {
  if (identity.cik !== "0001086222") return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/1086222/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== 1086222)
  )
    throw new Error("Service revenue source identity mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw new Error("Service table count exceeds bounds.");
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
  const scopeKey = (f: XbrlFact) =>
    `${f.context.start}|${f.context.end}|${f.currency}|${factKey(f)}`;
  for (const f of parsed.facts) {
    const k = f.tag + "|" + f.context.id;
    refs.set(k, [...(refs.get(k) ?? []), f]);
    const key = scopeKey(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const cell = (
    raw: string,
    columnIndex: number,
    span: number,
    rowSpan: number
  ): ServiceRevenueCell => {
    const output: ServiceRevenueCell = { columnIndex, span, rowSpan, label: visibleText(raw) };
    const declarations = [...raw.matchAll(/<ix:nonFraction\b[^>]*>/gi)];
    demand(declarations.length <= 2, "Too many declarations in an original monetary cell");
    if (!declarations.length) return output;
    const opening = declarations[0][0],
      body = raw.match(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/i)?.[0];
    demand(body, "Missing original numeric body");
    const name = attribute(opening, "name"),
      contextId = attribute(opening, "contextRef"),
      unitRef = attribute(opening, "unitRef"),
      format = attribute(opening, "format"),
      sign = attribute(opening, "sign");
    demand(
      name &&
        contextId &&
        unitRef &&
        format &&
        Number(attribute(opening, "scale")) === 3 &&
        Number(attribute(opening, "decimals")) === -3 &&
        units.some((u) => u.id === unitRef) &&
        /^(?:ixt:numdotdecimal|ixt:num-dot-decimal)$/.test(format) &&
        (sign === undefined || sign === "-"),
      "Unreviewed original monetary declaration"
    );
    demand(
      declarations.every(([x]) =>
        ["name", "unitRef", "scale", "decimals", "format", "sign"].every(
          (k) => attribute(x, k) === attribute(opening, k)
        )
      ),
      "Conflicting nested original declarations"
    );
    const text = visibleText(body).replaceAll(",", "");
    demand(/^\d+(?:\.\d+)?$/.test(text), "Invalid displayed numeric declaration");
    const amount = Number(text) * 1e3 * (sign === "-" ? -1 : 1),
      copies = refs.get(name + "|" + contextId);
    const f = copies?.find((f) => f.value === amount && f.decimals === -3);
    demand(
      f &&
        f.currency === "USD" &&
        !f.context.typed &&
        f.context.start &&
        f.context.end &&
        Number(f.context.cik) === 1086222 &&
        precise(groups.get(scopeKey(f)) ?? []),
      "Missing or conflicting original monetary fact"
    );
    const otherContexts = new Map<string, Record<string, string>>();
    for (const [x] of declarations) {
      const id = attribute(x, "contextRef");
      demand(id);
      const actual = refs
        .get(name + "|" + id)
        ?.find((other) => other.value === amount && other.decimals === -3);
      demand(
        actual &&
          actual.currency === f.currency &&
          actual.context.start === f.context.start &&
          actual.context.end === f.context.end &&
          Number(actual.context.cik) === 1086222 &&
          !actual.context.typed &&
          precise(groups.get(scopeKey(actual)) ?? []),
        "Conflicting nested original source context"
      );
      if (id !== contextId) otherContexts.set(id, actual.context.dimensions);
    }
    output.fact = {
      tag: f.tag,
      value: f.value,
      decimals: f.decimals,
      contextId: f.context.id,
      cik: f.context.cik,
      currency: "USD",
      startDate: f.context.start,
      endDate: f.context.end,
      dimensions: f.context.dimensions,
      ...(otherContexts.size
        ? {
            corroboratingContexts: [...otherContexts].map(([contextId, dimensions]) => ({
              contextId,
              dimensions
            }))
          }
        : {}),
      declarations: declarations.map(([x]) => ({
        tag: name,
        contextId: attribute(x, "contextRef")!,
        unitRef,
        scale: 3,
        format,
        ...(sign ? { sign: sign as "-" } : {}),
        ...(attribute(x, "id") ? { id: attribute(x, "id") } : {})
      }))
    };
    return output;
  };
  const grid = (table: string, selectedRows?: Set<number>): ServiceRevenueRow[] => {
    demand(table.length <= 512000 && !/<table\b/i.test(table.slice(table.indexOf(">") + 1)));
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    demand(rows.length >= 4 && rows.length <= 100);
    const occupied = new Set<string>();
    return rows.flatMap(([row], rowIndex) => {
      if (selectedRows && !selectedRows.has(rowIndex)) return [];
      let column = 0;
      const cells = [...row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map(
        ([raw]) => {
          while (occupied.has(`${rowIndex}:${column}`)) column++;
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
              column + span <= 64
          );
          const c = cell(raw, column, span, rowSpan);
          demand(rowSpan === 1 || !c.fact, "A monetary cell spans multiple original periods");
          for (let y = 0; y < rowSpan; y++)
            for (let x = 0; x < span; x++) {
              const key = `${rowIndex + y}:${column + x}`;
              demand(!occupied.has(key));
              occupied.add(key);
            }
          column += span;
          return c;
        }
      );
      demand(cells.length);
      return [{ rowIndex, cells }];
    });
  };
  const grids = new Map<number, ServiceRevenueRow[] | undefined>();
  const getGrid = (i: number) => {
    if (!grids.has(i)) {
      try {
        grids.set(i, grid(tables[i][0]));
      } catch (error) {
        if (!(error instanceof InvalidServiceSource)) throw error;
        onWithheld?.({ tableIndex: i, reason: error.message });
        grids.set(i, undefined);
      }
    }
    return grids.get(i);
  };
  const primary = (p: PeriodV2): ServiceRevenueRowsProof["primary"] | undefined => {
    for (const [tableIndex, t] of tables.entries()) {
      if (!t[0].includes("us-gaap:IncomeTaxExpenseBenefit")) continue;
      const text = visibleText(html.slice(Math.max(0, t.index! - 8000), t.index!));
      const title = text.match(
        /AKAMAI TECHNOLOGIES, INC\. (?:CONDENSED )?CONSOLIDATED STATEMENTS OF INCOME$/
      )?.[0];
      if (!title) continue;
      const originalRows = [...t[0].matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      const revenueIndex = originalRows.findIndex(
        ([row]) =>
          visibleText(row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/i)?.[0] ?? "") === "Revenue"
      );
      const taxIndex = originalRows.findIndex(
        ([row], i) => i > revenueIndex && row.includes("us-gaap:IncomeTaxExpenseBenefit")
      );
      if (revenueIndex < 1 || revenueIndex > 5 || taxIndex <= revenueIndex) continue;
      let rows: ServiceRevenueRow[];
      try {
        rows = grid(
          t[0],
          new Set([...Array.from({ length: revenueIndex + 1 }, (_, i) => i), taxIndex])
        );
      } catch (error) {
        if (!(error instanceof InvalidServiceSource)) throw error;
        onWithheld?.({ id: p.id, tableIndex, reason: error.message });
        continue;
      }
      const revenue = rows.find(
        (r) =>
          r.cells[0].label === "Revenue" &&
          r.cells.some((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)
      );
      if (!revenue) continue;
      const tax = rows.find(
        (r) =>
          r.rowIndex > revenue.rowIndex &&
          r.cells.some(
            (c) =>
              c.fact?.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
              c.fact.startDate === p.startDate &&
              c.fact.endDate === p.endDate
          )
      );
      if (!tax) continue;
      return { tableIndex, title, headerRows: rows.slice(0, revenue.rowIndex), revenue, tax };
    }
  };
  const output: PeriodV2[] = [];
  for (const p of existing) {
    if (
      p.coverage.segments ||
      p.accession !== filing.accession ||
      p.sourceUrl !== filing.sourceUrl ||
      p.filedAt !== filing.filedAt ||
      p.reportingCurrency !== "USD" ||
      p.displayCurrency !== "USD"
    )
      continue;
    const originalPrimary = primary(p);
    if (!originalPrimary) continue;
    let selected: PeriodV2 | undefined,
      ambiguous = false;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        tableIndex === originalPrimary.tableIndex ||
        (!table.includes("us-gaap:ContractWithCustomerSalesChannelAxis") &&
          !table.includes("akam:"))
      ) {
        // Members are declared in contexts, not necessarily repeated in a table.
        if (tableIndex === originalPrimary.tableIndex || !table.includes("Total revenue")) continue;
      }
      const rows = getGrid(tableIndex);
      if (!rows || rows.length > 10) continue;
      const first = rows.findIndex((r) => r.cells.some((c) => c.fact));
      if (first < 0) continue;
      const captions = rows.slice(first, -1).map((r) => r.cells[0].label);
      const profile = akamaiServiceProfiles.find(
        ([, branches]) =>
          JSON.stringify(branches.map((b) => b[0])) === JSON.stringify(captions) &&
          branches.every(([, member], i) =>
            rows[first + i].cells.some(
              (c) =>
                c.fact?.startDate === p.startDate &&
                c.fact.endDate === p.endDate &&
                c.fact.dimensions["us-gaap:ContractWithCustomerSalesChannelAxis"] ===
                  `akam:${member}Member`
            )
          )
      );
      if (!profile) continue;
      const proof: ServiceRevenueRowsProof = {
        ruleId: `akam-original-service-rows-${profile[0]}-v1`,
        reportDate: filing.reportDate,
        form: filing.form,
        units,
        tableIndex,
        rows,
        primary: originalPrimary
      };
      try {
        const segments = serviceRevenueSegments(p, proof);
        const next: PeriodV2 = {
          ...p,
          segments,
          segmentSourceUrl: p.sourceUrl,
          segmentBasis: serviceRevenueBasis,
          businessBreakdownSource: {
            method: "reviewed-service-revenue-rows",
            ruleId: proof.ruleId,
            serviceRevenueRows: proof,
            tableIndex,
            totalTableIndex: originalPrimary.tableIndex,
            sourceUrl: p.sourceUrl,
            accession: p.accession,
            revenueTag: p.metricSources.revenue!.tag,
            revenue: p.metrics.revenue!,
            revenueDecimals: -3,
            totalLabel: "Total revenue",
            omittedSubtotals: []
          },
          coverage: { ...p.coverage, segments: true }
        };
        if (!businessPeriod(next)) continue;
        next.coverage.sankey = !!flowPeriod(next);
        if (selected && JSON.stringify(selected.segments) !== JSON.stringify(next.segments)) {
          ambiguous = true;
          break;
        }
        selected ??= next;
      } catch (error) {
        if (!(error instanceof ServiceRevenueProofError)) throw error;
        onWithheld?.({ id: p.id, tableIndex, reason: error.message, proof });
      }
    }
    if (selected && !ambiguous) output.push(selected);
  }
  return output;
}
