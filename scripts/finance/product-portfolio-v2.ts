import type { ProductPortfolioCell, ProductPortfolioProof } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import {
  abbviePortfolios,
  abbvieProductMember,
  portfolioSegments,
  productContractTag,
  productPortfolioGroups,
  productPortfolioRule,
  ProductPortfolioProofError
} from "../../src/features/finance/product-portfolios";
import { attribute, factKey, precise, visibleText } from "./business-v2";
import { sourceLabel } from "../../src/features/finance/business-rules";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

class InvalidProductSource extends Error {}
function requireSource(condition: unknown): asserts condition {
  if (!condition) throw new InvalidProductSource("Unreviewed or incomplete original product table");
}
type Cell = {
  html: string;
  label: string;
  rowIndex: number;
  columnIndex: number;
  span: number;
  rowSpan: number;
};
function sourceGrid(html: string, productTable: boolean): Cell[] {
  requireSource(html.length <= 512000 && !/<table\b/i.test(html.slice(html.indexOf(">") + 1)));
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
  requireSource(rows.length > 3 && rows.length <= 200);
  const occupied = new Set<string>(),
    cells: Cell[] = [];
  for (const [rowIndex, [row]] of rows.entries()) {
    let columnIndex = 0;
    for (const [raw] of row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)) {
      while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex++;
      const opening = raw.match(/^<[^>]*>/)![0],
        span = Number(attribute(opening, "colspan") ?? 1),
        rowSpan = Number(attribute(opening, "rowspan") ?? 1);
      requireSource(
        Number.isInteger(span) &&
          span >= 1 &&
          span <= 32 &&
          Number.isInteger(rowSpan) &&
          rowSpan >= 1 &&
          rowSpan <= 2 &&
          columnIndex + span <= 64 &&
          rowIndex + rowSpan <= rows.length
      );
      if (rowSpan > 1)
        requireSource(
          !/<ix:nonFraction\b/i.test(raw) && (!productTable || (rowIndex === 1 && span === 9))
        );
      cells.push({ html: raw, label: visibleText(raw), rowIndex, columnIndex, span, rowSpan });
      for (let r = 0; r < rowSpan; r++)
        for (let c = 0; c < span; c++) {
          const key = `${rowIndex + r}:${columnIndex + c}`;
          requireSource(!occupied.has(key));
          occupied.add(key);
        }
      columnIndex += span;
    }
  }
  return cells;
}
function readSection(
  html: string,
  tables: RegExpMatchArray[],
  startTable: number,
  period: PeriodV2,
  filing: SecFiling,
  parsed: ParsedFiling
): PeriodV2 | undefined {
  try {
    const allRefs = new Map<string, XbrlFact[]>(),
      grouped = new Map<string, XbrlFact[]>();
    for (const fact of parsed.facts) {
      const key = `${fact.tag}|${fact.context.id}`;
      allRefs.set(key, [...(allRefs.get(key) ?? []), fact]);
      if (
        fact.context.start === period.startDate &&
        fact.context.end === period.endDate &&
        fact.currency === "USD" &&
        !fact.context.typed
      )
        grouped.set(factKey(fact), [...(grouped.get(factKey(fact)) ?? []), fact]);
    }
    const best = new Map([...grouped].map(([key, copies]) => [key, precise(copies)]));
    const readCell = (cell: Cell, exactDate: boolean): ProductPortfolioCell => {
      const openings = [...cell.html.matchAll(/<ix:nonFraction\b[^>]*>/gi)].map(([tag]) => tag);
      requireSource(openings.length <= 2);
      const output: ProductPortfolioCell = {
        columnIndex: cell.columnIndex,
        span: cell.span,
        label: cell.label,
        facts: []
      };
      if (!openings.length) return output;
      const variants = openings.map((tag) => {
        const facts = allRefs.get(`${attribute(tag, "name")}|${attribute(tag, "contextRef")}`);
        requireSource(facts?.length);
        return facts;
      });
      if (
        !exactDate &&
        variants.every(
          (facts) =>
            facts[0].context.start !== period.startDate || facts[0].context.end !== period.endDate
        )
      )
        return output;
      const datesMatch = variants.every((facts) =>
        facts.every(
          (f) =>
            f.context.start === period.startDate &&
            f.context.end === period.endDate &&
            Number(f.context.cik) === 1551152 &&
            !f.context.typed &&
            f.currency === "USD"
        )
      );
      requireSource(datesMatch);
      if (openings.length === 2) {
        for (const key of ["contextRef", "unitRef", "scale", "decimals", "sign", "format"])
          requireSource(attribute(openings[0], key) === attribute(openings[1], key));
        const names = openings.map((t) => attribute(t, "name"));
        requireSource(
          (names[0] === names[1] && names[0] === productContractTag) ||
            (names.includes("us-gaap:Revenues") && names.includes(productContractTag))
        );
        // Identical lexical content must be shared by nested declarations, not two adjacent numbers.
        requireSource(
          /<ix:nonFraction\b[^>]*>[\s\S]*?<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>\s*<\/ix:nonFraction>/i.test(
            cell.html
          )
        );
      }
      const lexical = cell.label.replace(/[,$\s]/g, ""),
        zero = ["—", "–", "-"].includes(lexical);
      requireSource(zero || /^\d+(?:\.\d+)?$/.test(lexical));
      const value = zero ? 0 : Number(lexical) * 1e6;
      for (const [index, opening] of openings.entries()) {
        requireSource(
          attribute(opening, "unitRef") === "usd" &&
            attribute(opening, "scale") === "6" &&
            attribute(opening, "decimals") === "-6" &&
            attribute(opening, "sign") === undefined
        );
        const matching = variants[index].filter((f) => f.value === value && f.decimals === -6);
        requireSource(matching.length > 0);
        const original = matching[0],
          coherent = best.get(factKey(original));
        requireSource(
          coherent && coherent.value === value && coherent.decimals >= original.decimals
        );
        let fact = output.facts.find(
          (f) => f.tag === original.tag && f.contextId === original.context.id
        );
        if (!fact) {
          fact = {
            tag: original.tag,
            value,
            decimals: -6,
            contextId: original.context.id,
            dimensions: original.context.dimensions,
            declarations: []
          };
          output.facts.push(fact);
        }
        fact.declarations.push({
          ...(attribute(opening, "id") ? { id: attribute(opening, "id") } : {}),
          format: attribute(opening, "format") ?? ""
        });
      }
      return output;
    };
    const header = (cells: Cell[]) => {
      const years = cells.filter((c) => c.rowIndex <= 3 && /^\d{4}$/.test(c.label));
      const captions = cells.filter((c) => /^(?:Three|Six|Nine) months ended/.test(c.label));
      const current = years.filter((y) => y.label === period.endDate.slice(0, 4));
      let year: Cell | undefined, temporal: Cell | undefined;
      let method: ProductPortfolioProof["tables"][number]["temporal"]["method"] =
        "original-spanning-header";
      if (period.kind === "annual") {
        requireSource(current.length === 1);
        year = current[0];
        temporal = cells.find(
          (c) =>
            c.rowIndex === year!.rowIndex &&
            /^years ended December 31 \(in millions\)$/i.test(c.label)
        );
      } else {
        const threeMonths = captions.filter((c) => /^Three months ended/.test(c.label));
        requireSource(threeMonths.length === 1);
        temporal = threeMonths[0];
        const spanned = current.filter(
          (y) =>
            y.columnIndex >= temporal!.columnIndex &&
            y.columnIndex + y.span <= temporal!.columnIndex + temporal!.span &&
            temporal!.rowIndex + temporal!.rowSpan <= y.rowIndex
        );
        if (spanned.length === 1) year = spanned[0];
        else {
          requireSource(
            temporal.label === "Three months ended March 31," &&
              captions.length === 1 &&
              years.length === 2 &&
              new Set(years.map((y) => y.label)).size === 2 &&
              current.length === 1 &&
              period.startDate === `${period.endDate.slice(0, 4)}-01-01` &&
              period.endDate.endsWith("-03-31")
          );
          for (const cell of cells)
            for (const [opening] of cell.html.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
              const facts = allRefs.get(
                `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`
              );
              requireSource(facts?.length);
              for (const fact of facts) {
                if (!fact.context.dimensions["srt:ProductOrServiceAxis"]) continue;
                const containing = years.filter(
                  (y) =>
                    cell.columnIndex >= y.columnIndex && cell.columnIndex < y.columnIndex + y.span
                );
                requireSource(
                  containing.length === 1 &&
                    fact.context.start === `${containing[0].label}-01-01` &&
                    fact.context.end === `${containing[0].label}-03-31` &&
                    fact.currency === "USD" &&
                    !fact.context.typed
                );
              }
            }
          year = current[0];
          method = "original-single-Q1-table-caption";
        }
      }
      requireSource(year && temporal && year.span === 3);
      return {
        year: {
          label: year.label,
          rowIndex: year.rowIndex,
          columnIndex: year.columnIndex,
          span: year.span
        },
        temporal: {
          label: temporal.label,
          rowIndex: temporal.rowIndex,
          columnIndex: temporal.columnIndex,
          span: temporal.span,
          rowSpan: temporal.rowSpan,
          method
        },
        ...(method === "original-single-Q1-table-caption"
          ? {
              quarter1ComparisonYears: years.map((y) => ({
                label: y.label,
                columnIndex: y.columnIndex,
                span: y.span
              }))
            }
          : {})
      };
    };
    const proof: ProductPortfolioProof = {
      ruleId: productPortfolioRule,
      startDate: period.startDate,
      endDate: period.endDate,
      reportDate: filing.reportDate,
      form: filing.form,
      tables: [],
      continuations: [],
      headings: [],
      products: [],
      total: undefined!,
      primary: undefined!
    };
    let portfolio: string | undefined,
      active: ProductPortfolioProof["products"][number] | undefined;
    for (const tableIndex of [startTable, startTable + 2]) {
      requireSource(tables[tableIndex]);
      const cells = sourceGrid(tables[tableIndex][0], true),
        h = header(cells);
      const tableProof = {
        tableIndex,
        rowCount: Math.max(...cells.map((c) => c.rowIndex)) + 1,
        headerRows: [] as number[],
        emptyRows: [] as number[],
        ...h
      };
      proof.tables.push(tableProof);
      for (let rowIndex = 0; rowIndex < tableProof.rowCount; rowIndex++) {
        const row = cells.filter((c) => c.rowIndex === rowIndex),
          label = row[0]?.label ?? "";
        const scope =
          abbviePortfolios[label] || ["All other", "Total net revenues"].includes(label)
            ? ""
            : (row[1]?.label ?? "");
        if (abbviePortfolios[label]) {
          portfolio = label;
          active = undefined;
          proof.headings.push({ label, tableIndex, rowIndex });
          continue;
        }
        if (rowIndex <= h.year.rowIndex) {
          tableProof.headerRows.push(rowIndex);
          continue;
        }
        const selected = row
          .filter(
            (c) =>
              c.columnIndex >= h.year.columnIndex &&
              c.columnIndex < h.year.columnIndex + h.year.span
          )
          .map((c) => readCell(c, true));
        if (label === "Total net revenues") {
          requireSource(!proof.total);
          proof.total = { tableIndex, rowIndex, cells: selected };
          continue;
        }
        if (!label && !scope && selected.every((c) => !c.label && !c.facts.length)) {
          tableProof.emptyRows.push(rowIndex);
          continue;
        }
        if (label) {
          const member = abbvieProductMember(label);
          requireSource(member);
          active = { id: member, label, ...(label === "All other" ? {} : { portfolio }), rows: [] };
          proof.products.push(active);
        }
        requireSource(active);
        active.rows.push({ tableIndex, rowIndex, label, scope, cells: selected });
      }
      if (proof.total) break;
      requireSource(tableIndex === startTable && tables[startTable + 1] && tables[startTable + 2]);
      const between = html.slice(
        tables[startTable].index! + tables[startTable][0].length,
        tables[startTable + 2].index!
      );
      requireSource(
        [...between.matchAll(/<table\b/gi)].length === 1 &&
          !/<ix:nonFraction\b/i.test(tables[startTable + 1][0])
      );
      proof.continuations.push({
        fromTable: startTable,
        toTable: startTable + 2,
        footerTableIndex: startTable + 1,
        label: visibleText(between)
      });
    }
    requireSource(proof.total);
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        proof.tables.some((t) => t.tableIndex === tableIndex) ||
        !/us-gaap:IncomeTaxExpenseBenefit/.test(table) ||
        !/us-gaap:NetIncomeLoss/.test(table)
      )
        continue;
      let cells: Cell[];
      try {
        cells = sourceGrid(table, false);
      } catch (error) {
        if (error instanceof InvalidProductSource) continue;
        throw error;
      }
      for (const rowIndex of new Set(cells.map((c) => c.rowIndex))) {
        const row = cells.filter((c) => c.rowIndex === rowIndex);
        if (sourceLabel(row[0].label) !== "Net revenues") continue;
        for (const raw of row) {
          const cell = readCell(raw, false);
          if (
            !cell.facts.some(
              (f) =>
                f.tag === period.metricSources.revenue?.tag &&
                f.value === period.metrics.revenue &&
                !Object.keys(f.dimensions).length
            )
          )
            continue;
          if (proof.primary)
            requireSource(JSON.stringify(proof.primary.cell.facts) === JSON.stringify(cell.facts));
          else proof.primary = { tableIndex, rowIndex, label: "Net revenues", cell };
        }
      }
    }
    requireSource(proof.primary);
    productPortfolioGroups(proof, period);
    const next: PeriodV2 = {
      ...period,
      segments: portfolioSegments(period, proof),
      segmentSourceUrl: filing.sourceUrl,
      segmentBasis:
        "Product-portfolio revenue calculated by summing the filing’s reported product rows under its original portfolio headings. Product totals already include their disclosed collaboration components; they are counted once. Original product, geographic and arrangement scopes, declared zeros and unfilled blanks are preserved in the source record. Portfolio sums are calculated values, not reported portfolio subtotals.",
      businessBreakdownSource: {
        method: "reported-product-portfolios",
        ruleId: productPortfolioRule,
        productPortfolios: proof,
        tableIndex: proof.tables[0].tableIndex,
        totalTableIndex: proof.total.tableIndex,
        sourceUrl: filing.sourceUrl,
        accession: filing.accession,
        revenueTag: period.metricSources.revenue!.tag,
        revenue: period.metrics.revenue!,
        revenueDecimals: -6,
        totalLabel: "Total net revenues",
        omittedSubtotals: []
      },
      coverage: { ...period.coverage, segments: true, sankey: false }
    };
    requireSource(businessPeriod(next));
    next.coverage.sankey = !!flowPeriod(next);
    return next;
  } catch (error) {
    if (error instanceof InvalidProductSource || error instanceof ProductPortfolioProofError) {
      return;
    }
    throw error;
  }
}

export function enrichProductPortfolioPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  if (identity.cik !== "0001551152") return [];
  const url = new URL(filing.sourceUrl);
  if (
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/1551152/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== 1551152)
  )
    throw new Error("Product portfolio filing identity mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  requireSource(tables.length <= 5000);
  const output: PeriodV2[] = [];
  for (const period of existing) {
    if (
      period.coverage.segments ||
      period.accession !== filing.accession ||
      period.sourceUrl !== filing.sourceUrl ||
      period.filedAt !== filing.filedAt ||
      period.reportingCurrency !== "USD" ||
      period.displayCurrency !== "USD" ||
      (period.metrics.revenue ?? 0) <= 0 ||
      period.metricSources.revenue?.method !== "reported" ||
      period.revenueAdjustments?.length
    )
      continue;
    let selected: PeriodV2 | undefined;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        !/>Immunology</.test(table) ||
        (!/Net revenues|Total net revenues/.test(visibleText(table)) &&
          !/Skyrizi|SKYRIZI|HUMIRA|Humira/.test(visibleText(table)))
      )
        continue;
      const next = readSection(html, tables, tableIndex, period, filing, parsed);
      if (!next) continue;
      if (selected && JSON.stringify(selected.segments) !== JSON.stringify(next.segments)) {
        selected = undefined;
        break;
      }
      selected ??= next;
    }
    if (selected) output.push(selected);
  }
  return output;
}
