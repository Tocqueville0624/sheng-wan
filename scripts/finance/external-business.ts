import {
  sameDimensions,
  sourceLabel,
  type BusinessRule
} from "../../src/features/finance/business-rules";
import type { PeriodV2 } from "../../src/features/finance/v2-types";
import { attribute, factKey, halfUnit, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

type Cell = { html: string; label: string; column: number; span: number };
type ColumnProof = NonNullable<
  NonNullable<PeriodV2["businessBreakdownSource"]>["externalCustomerColumns"]
>;
function cells(row: string): Cell[] | undefined {
  const output: Cell[] = [];
  let column = 0;
  for (const [html] of row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)) {
    const opening = html.match(/^<[^>]*>/)![0];
    const span = Number(attribute(opening, "colspan") ?? 1);
    if (
      !Number.isInteger(span) ||
      span < 1 ||
      span > 200 ||
      column + span > 1000 ||
      Number(attribute(opening, "rowspan") ?? 1) !== 1
    )
      return;
    output.push({ html, label: sourceLabel(visibleText(html)), column, span });
    column += span;
  }
  return output;
}

/** Read one complete reviewed external-sales row. Gross/internal rows are
 * different scopes and never supply a missing external-customer amount.
 */
export function readExternalBusinessColumns(
  tables: RegExpMatchArray[],
  period: PeriodV2,
  filing: SecFiling,
  parsed: ParsedFiling,
  rule: BusinessRule
): PeriodV2 | undefined {
  const schema = rule.externalCustomerColumns;
  if (!schema || rule.totalTag !== period.metricSources.revenue?.tag) return;
  const allRefs = new Map(parsed.facts.map((f) => [`${f.tag}|${f.context.id}`, f]));
  const current = parsed.facts.filter(
    (f) => f.context.start === period.startDate && f.context.end === period.endDate
  );
  const groups = new Map<string, XbrlFact[]>();
  for (const f of current) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
  const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
  const currentRefs = new Map(
    current.map((f) => [`${f.tag}|${f.context.id}`, best.get(factKey(f))])
  );
  const rowFacts = (cell: Cell): { fact: XbrlFact; column: number; span: number }[] | undefined => {
    const result = [];
    for (const [opening] of cell.html.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
      const ref = `${attribute(opening, "name")}|${attribute(opening, "contextRef")}`;
      const any = allRefs.get(ref);
      // An unresolved/invalid numeric cell cannot disappear from a partition.
      if (!any) return;
      if (any.context.start !== period.startDate || any.context.end !== period.endDate) continue;
      if (any.context.typed || any.currency !== "USD") return;
      const fact = currentRefs.get(ref);
      if (
        !fact ||
        fact.context.typed ||
        fact.currency !== "USD" ||
        fact.tag !== rule.totalTag ||
        halfUnit(fact) === undefined
      )
        return;
      result.push({ fact, column: cell.column, span: cell.span });
    }
    return result;
  };
  let primary: { fact: XbrlFact; tableIndex: number } | undefined;
  for (const [tableIndex, [table]] of tables.entries()) {
    if (
      table.length > 512000 ||
      /<table\b/i.test(table.slice(6)) ||
      !/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)
    )
      continue;
    for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
      const parts = cells(row);
      if (!parts || parts[0]?.label !== schema.primaryLabel) continue;
      const values = parts.map(rowFacts);
      if (values.some((v) => !v)) continue;
      const facts = values.flatMap((v) => v!).map((v) => v.fact);
      if (
        facts.length === 1 &&
        !Object.keys(facts[0].context.dimensions).length &&
        facts[0].value === period.metrics.revenue
      )
        primary = { fact: facts[0], tableIndex };
    }
  }
  if (!primary) return;
  const labels = [
    ...rule.branches.map((b) => b.columnLabel ?? b.label),
    ...schema.totalLabels,
    ...schema.blankLabels
  ];
  for (const [tableIndex, [table]] of tables.entries()) {
    if (
      table.length > 512000 ||
      /<table\b/i.test(table.slice(6)) ||
      tableIndex === primary.tableIndex
    )
      continue;
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
    let header: { cells: Cell[]; rowIndex: number } | undefined;
    for (const [rowIndex, [row]] of rows.entries()) {
      const parts = cells(row);
      if (!parts) {
        header = undefined;
        continue;
      }
      if (!/<ix:nonFraction\b/i.test(row)) {
        const nonempty = parts.filter((c) => c.label);
        if (
          nonempty.length === labels.length &&
          labels.every((label) => nonempty.filter((c) => c.label === label).length === 1)
        )
          header = { cells: nonempty, rowIndex };
        continue;
      }
      if (!header || parts[0]?.label !== rule.totalLabel) continue;
      const values = parts.map(rowFacts);
      if (values.some((v) => !v)) continue;
      const monetary = values.flatMap((v) => v!);
      const used = new Set<number>();
      const branches: {
        branch: BusinessRule["branches"][number];
        fact: XbrlFact;
        column: number;
      }[] = [];
      const totals: ColumnProof["totals"] = [];
      const blanks: { label: string; columnIndex: number }[] = [];
      let valid = true;
      for (const heading of header.cells) {
        const numeric = monetary.filter(
          (v) => v.column >= heading.column && v.column + v.span <= heading.column + heading.span
        );
        const branch = rule.branches.find((b) => (b.columnLabel ?? b.label) === heading.label);
        if (schema.blankLabels.includes(heading.label)) {
          const content = parts.filter(
            (c) => c.column >= heading.column && c.column + c.span <= heading.column + heading.span
          );
          if (
            numeric.length ||
            content.some(
              (c) => /<ix:nonFraction\b/i.test(c.html) || !/^(?:\$|[—–-])?$/.test(c.label)
            )
          ) {
            valid = false;
            break;
          }
          blanks.push({ label: heading.label, columnIndex: heading.column });
          continue;
        }
        if (numeric.length !== 1 || used.has(numeric[0].column)) {
          valid = false;
          break;
        }
        const { fact, column } = numeric[0];
        used.add(column);
        if (branch) {
          if (
            fact.tag !== branch.tag ||
            !sameDimensions(fact.context.dimensions, branch.dimensions) ||
            fact.value < 0
          ) {
            valid = false;
            break;
          }
          branches.push({ branch, fact, column });
        } else if (
          schema.totalLabels.includes(heading.label) &&
          !Object.keys(fact.context.dimensions).length &&
          fact.value === period.metrics.revenue
        ) {
          totals.push({
            label: heading.label,
            tag: fact.tag,
            value: fact.value,
            decimals: fact.decimals,
            dimensions: fact.context.dimensions,
            columnIndex: column
          });
        } else {
          valid = false;
          break;
        }
      }
      if (
        !valid ||
        used.size !== monetary.length ||
        branches.length !== rule.branches.length ||
        totals.length !== schema.totalLabels.length ||
        blanks.length !== schema.blankLabels.length
      )
        continue;
      const total = totals.at(-1)!;
      const difference = total.value - branches.reduce((sum, b) => sum + b.fact.value, 0);
      const bound = branches.reduce((sum, b) => sum + halfUnit(b.fact)!, halfUnit(primary.fact)!);
      if (Math.abs(difference) > bound || Math.abs(difference) > total.value * 0.001) continue;
      const next: PeriodV2 = {
        ...period,
        segments: branches.map(({ branch, fact, column }) => ({
          id: `reported-${branch.label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
          label: branch.label,
          revenue: fact.value,
          revenueSource: {
            sourceUrl: filing.sourceUrl,
            accession: filing.accession,
            filedAt: filing.filedAt,
            startDate: period.startDate,
            endDate: period.endDate,
            currency: fact.currency,
            tag: fact.tag,
            dimensions: fact.context.dimensions,
            value: fact.value,
            decimals: fact.decimals,
            tableLabel: branch.label,
            rowLabel: rule.totalLabel,
            rowIndex,
            columnIndex: column
          }
        })),
        segmentSourceUrl: filing.sourceUrl,
        segmentBasis: rule.basis,
        businessBreakdownSource: {
          method: "reviewed-segment-table",
          ruleId: rule.id,
          layout: "columns",
          tableIndex,
          totalTableIndex: primary.tableIndex,
          headerRowIndex: header.rowIndex,
          rowIndex,
          sourceUrl: filing.sourceUrl,
          accession: filing.accession,
          revenueTag: total.tag,
          revenue: total.value,
          revenueDecimals: total.decimals,
          columnIndex: total.columnIndex,
          totalLabel: rule.totalLabel,
          omittedSubtotals: [],
          externalCustomerColumns: {
            headers: header.cells.map((c) => ({
              label: c.label,
              columnIndex: c.column,
              span: c.span
            })),
            totals,
            blanks
          }
        },
        revenueAdjustments: difference
          ? [{ id: "source-rounding", label: "Source rounding", revenue: difference }]
          : undefined,
        coverage: { ...period.coverage, segments: true }
      };
      if (!businessPeriod(next)) continue;
      next.coverage.sankey = !!flowPeriod(next);
      return next;
    }
  }
}
