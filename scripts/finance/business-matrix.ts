import {
  businessAxes,
  businessRules,
  isBusinessCategory,
  isZeroRevenueReconciliation,
  sameDimensions,
  sourceLabel
} from "../../src/features/finance/business-rules";
import type { RevenueSegment } from "../../src/features/finance/types";
import type { CatalogCompany, PeriodV2 } from "../../src/features/finance/v2-types";
import { attribute, factKey, halfUnit, precise, visibleText } from "./business-v2";
import type { ParsedFiling, XbrlFact } from "./ixbrl";
import type { SecFiling } from "./sec-shared";
import { businessPeriod, flowPeriod } from "./v2-model";

type RowFact = { fact: XbrlFact; column: number };
type Branch = RowFact & { label: string };
const scopes: Record<string, string>[] = [
  {},
  { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }
];

type Cell = { html: string; label: string; column: number; span: number };
function tableCells(row: string): Cell[] | undefined {
  const cells: Cell[] = [];
  let column = 0;
  for (const [html] of row.matchAll(/<t[dh]\b[^>]*\/>|<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)) {
    const span = Number(attribute(html.match(/^<[^>]*>/)![0], "colspan") ?? 1);
    if (!Number.isInteger(span) || span < 1 || span > 200 || column + span > 1000) return;
    cells.push({ html, column, span, label: visibleText(html) });
    column += span;
  }
  return cells;
}

const revenueRow =
  /^(?:total(?:\s+(?:consolidated\s+)?(?:revenues?|sales))?|(?:net\s+)?(?:revenues?|sales)(?:\s+(?:to\s+customers|from\s+external\s+customers))?)$/i;
const totalColumn = /^total(?:\s+(?:revenues?|sales))?$/i;

/** A dimensioned segment aggregate is corroborated by an independent primary
 * consolidated revenue row, rather than assuming its classification is GAAP.
 */
function primaryRevenue(
  tables: RegExpMatchArray[],
  period: PeriodV2,
  refs: Map<string, XbrlFact>,
  best: Map<string, XbrlFact | undefined>
): { fact: XbrlFact; tableIndex: number } | undefined {
  for (const [tableIndex, [table]] of tables.entries()) {
    if (table.length > 512000 || /<table\b/i.test(table.slice(6))) continue;
    if (!/<ix:nonFraction\b[^>]*IncomeTax/i.test(table)) continue;
    for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
      const cells = tableCells(row);
      if (!cells || !revenueRow.test(sourceLabel(cells[0]?.label ?? ""))) continue;
      const values = [...row.matchAll(/<ix:nonFraction\b[^>]*>/gi)].flatMap(([opening]) => {
        const f = refs.get(`${attribute(opening, "name")}|${attribute(opening, "contextRef")}`);
        const fact = f && best.get(factKey(f));
        return fact &&
          fact.tag === period.metricSources.revenue!.tag &&
          !Object.keys(fact.context.dimensions).length &&
          fact.value === period.metrics.revenue
          ? [fact]
          : [];
      });
      if (values.length === 1) return { fact: values[0], tableIndex };
    }
  }
}

/** Column captions must cover the actual numeric cells, including colspans and
 * empty currency/spacer cells. Explicit preceding subtotals are corroborated
 * against all their source branches and never added again. Every numeric cell
 * in the current-period revenue row must be accounted for; no subsets are fit.
 */
function readBusinessColumns(
  rows: RegExpMatchArray[],
  tableIndex: number,
  period: PeriodV2,
  filing: SecFiling,
  refs: Map<string, XbrlFact>,
  best: Map<string, XbrlFact | undefined>,
  consolidated: { fact: XbrlFact; tableIndex: number } | undefined
): PeriodV2 | undefined {
  const currentContexts = new Set([...refs.values()].map((fact) => fact.context.id));
  const headers: { cells: Cell[]; rowIndex: number }[] = [];
  for (const [rowIndex, [row]] of rows.entries()) {
    const cells = tableCells(row);
    if (!cells) return;
    if (!/<ix:nonFraction\b/i.test(row)) {
      headers.push({ cells, rowIndex });
      continue;
    }
    if (!revenueRow.test(sourceLabel(cells[0]?.label ?? ""))) continue;
    const values: (RowFact & { span: number })[] = [];
    let invalid = false;
    for (const cell of cells) {
      const current = [...cell.html.matchAll(/<ix:nonFraction\b[^>]*>/gi)].flatMap(([opening]) => {
        const tag = attribute(opening, "name");
        const context = attribute(opening, "contextRef");
        const f = refs.get(`${tag}|${context}`);
        // A malformed fact in a known current-period context cannot silently
        // disappear from this revenue row (for example an unknown zero transform).
        if (tag === period.metricSources.revenue!.tag && currentContexts.has(context!) && !f)
          invalid = true;
        return f?.tag === period.metricSources.revenue!.tag ? [f] : [];
      });
      if (current.length > 1) invalid = true;
      for (const f of current) {
        const fact = best.get(factKey(f));
        if (!fact || fact.value < 0) invalid = true;
        else values.push({ fact, column: cell.column, span: cell.span });
      }
    }
    if (invalid || values.length < 3 || values.length > 41) continue;
    const total = values.at(-1)!;
    if (total.fact.value !== period.metrics.revenue) continue;
    for (const axis of businessAxes) {
      for (const qualifiers of scopes) {
        const dimensions = total.fact.context.dimensions;
        const parent = !!dimensions[axis];
        const expectedTotal = parent ? { ...qualifiers, [axis]: dimensions[axis] } : qualifiers;
        if (!sameDimensions(dimensions, expectedTotal) && Object.keys(dimensions).length) continue;
        if (parent && (!consolidated || consolidated.tableIndex === tableIndex)) continue;
        const aggregateScope = (fact: XbrlFact) =>
          !Object.keys(fact.context.dimensions).length ||
          sameDimensions(fact.context.dimensions, qualifiers) ||
          (!!fact.context.dimensions[axis] &&
            sameDimensions(fact.context.dimensions, {
              ...qualifiers,
              [axis]: fact.context.dimensions[axis]
            }));
        for (const header of [...headers].reverse()) {
          const captions = values.map((value) =>
            header.cells.filter(
              (cell) =>
                cell.column <= value.column &&
                cell.column + cell.span >= value.column + value.span &&
                cell.label.length <= 180 &&
                /\p{L}/u.test(cell.label)
            )
          );
          if (captions.some((cells) => cells.length !== 1)) continue;
          const names = captions.map(([cell]) => sourceLabel(cell.label));
          if (new Set(names).size !== names.length || !totalColumn.test(names.at(-1)!)) continue;
          const branches: Branch[] = [];
          const omitted: NonNullable<PeriodV2["businessBreakdownSource"]>["omittedSubtotals"] = [];
          const zeros: NonNullable<
            NonNullable<PeriodV2["businessBreakdownSource"]>["omittedZeroColumns"]
          > = [];
          let valid = true;
          for (const [index, value] of values.slice(0, -1).entries()) {
            const { fact, column } = value;
            const label = names[index];
            if (/^(?:total|subtotal)\b/i.test(label)) {
              const sum = branches.reduce((sum, b) => sum + b.fact.value, 0);
              const bound = branches.reduce((sum, b) => sum + halfUnit(b.fact)!, halfUnit(fact)!);
              if (
                branches.length < 2 ||
                !aggregateScope(fact) ||
                Math.abs(fact.value - sum) > bound ||
                Math.abs(fact.value - sum) > total.fact.value * 0.001
              ) {
                valid = false;
                break;
              }
              omitted.push({
                label,
                tag: fact.tag,
                dimensions: fact.context.dimensions,
                value: fact.value,
                decimals: fact.decimals,
                columnIndex: column
              });
            } else if (
              fact.value === 0 &&
              isZeroRevenueReconciliation(label, fact.context.dimensions)
            ) {
              zeros.push({
                label,
                tag: fact.tag,
                dimensions: fact.context.dimensions,
                value: 0,
                decimals: fact.decimals,
                columnIndex: column
              });
            } else {
              const member = fact.context.dimensions[axis];
              if (
                !member ||
                !isBusinessCategory(axis, member, label) ||
                !sameDimensions(fact.context.dimensions, { ...qualifiers, [axis]: member }) ||
                (parent && member === dimensions[axis])
              ) {
                valid = false;
                break;
              }
              branches.push({ fact, column, label });
            }
          }
          if (
            !valid ||
            branches.length < 2 ||
            branches.length > 20 ||
            new Set(branches.map(({ fact }) => factKey(fact))).size !== branches.length
          )
            continue;
          const difference = total.fact.value - branches.reduce((sum, b) => sum + b.fact.value, 0);
          const bound = branches.reduce((sum, b) => sum + halfUnit(b.fact)!, halfUnit(total.fact)!);
          if (Math.abs(difference) > bound || Math.abs(difference) > total.fact.value * 0.001)
            continue;
          const segments: RevenueSegment[] = branches.map(({ fact, column, label }) => ({
            id: `reported-${axis}-${fact.context.dimensions[axis]}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
            label,
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
              tableLabel: label,
              columnIndex: column
            }
          }));
          const next: PeriodV2 = {
            ...period,
            segments,
            segmentSourceUrl: filing.sourceUrl,
            segmentBasis:
              "Reported revenue by business from one source-table row. Aligned column headers identify each business; explicit subtotals are checked and counted only once. The source total reconciles to consolidated revenue.",
            businessBreakdownSource: {
              method: "statement-revenue-matrix",
              layout: "columns",
              tableIndex,
              totalTableIndex: parent ? consolidated!.tableIndex : undefined,
              headerRowIndex: header.rowIndex,
              rowIndex,
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              revenueTag: total.fact.tag,
              revenue: total.fact.value,
              revenueDecimals: total.fact.decimals,
              axis,
              qualifiers,
              columnIndex: total.column,
              totalDimensions: dimensions,
              totalLabel: names.at(-1)!,
              omittedSubtotals: omitted,
              omittedZeroColumns: zeros.length ? zeros : undefined
            },
            revenueAdjustments: difference
              ? [{ id: "source-rounding", label: "Source rounding", revenue: difference }]
              : undefined,
            coverage: { ...period.coverage, segments: true }
          };
          if (businessPeriod(next)) {
            next.coverage.sankey = !!flowPeriod(next);
            return next;
          }
        }
      }
    }
  }
}

const eliminationDimensions = {
  "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
};
const eliminationLabel =
  /^(?:inter[ -]?segment (?:revenue |sales )?eliminations?|eliminations? of inter[ -]?segment(?: (?:revenues?|sales))?)$/i;

/** Source-reported gross segment revenues may include internal sales. Preserve
 * the explicit subtotal and negative elimination in the same source column;
 * never allocate the elimination to segments or turn a residual into a fact.
 */
function readBusinessRows(
  rows: RegExpMatchArray[],
  tableIndex: number,
  period: PeriodV2,
  filing: SecFiling,
  refs: Map<string, XbrlFact>,
  best: Map<string, XbrlFact | undefined>
): PeriodV2 | undefined {
  for (const axis of businessAxes) {
    for (const qualifiers of scopes) {
      let branches: (Branch & { rowIndex: number })[] = [];
      let omitted: NonNullable<PeriodV2["businessBreakdownSource"]>["omittedSubtotals"] = [];
      let elimination: (Branch & { rowIndex: number }) | undefined;
      const reset = () => {
        branches = [];
        omitted = [];
        elimination = undefined;
      };
      for (const [rowIndex, [row]] of rows.entries()) {
        const cells = tableCells(row);
        if (!cells) {
          reset();
          continue;
        }
        const label = sourceLabel(cells[0]?.label ?? "");
        const values: RowFact[] = [];
        let invalid = false;
        let currentRevenue = false;
        let currentFinancial = false;
        for (const cell of cells) {
          for (const [opening] of cell.html.matchAll(/<ix:nonFraction\b[^>]*>/gi)) {
            const f = refs.get(`${attribute(opening, "name")}|${attribute(opening, "contextRef")}`);
            if (!f) continue;
            currentFinancial = true;
            if (f.tag !== period.metricSources.revenue!.tag) continue;
            currentRevenue = true;
            const d = f.context.dimensions;
            const expected = d[axis] ? { ...qualifiers, [axis]: d[axis] } : qualifiers;
            if (
              !sameDimensions(d, expected) &&
              Object.keys(d).length &&
              !sameDimensions(d, eliminationDimensions)
            )
              continue;
            const fact = best.get(factKey(f));
            if (!fact) invalid = true;
            else values.push({ fact, column: cell.column + cell.span - 1 });
          }
        }
        if (!currentRevenue) {
          if (currentFinancial) reset();
          continue;
        }
        if (invalid || values.length !== 1 || !label || label.length > 180) {
          reset();
          continue;
        }
        const value = values[0],
          fact = value.fact,
          d = fact.context.dimensions;
        if (sameDimensions(d, eliminationDimensions)) {
          if (
            elimination ||
            omitted.length !== 1 ||
            fact.value > 0 ||
            !eliminationLabel.test(label) ||
            !Object.keys(qualifiers).length ||
            branches.some((b) => b.column !== value.column)
          ) {
            reset();
            continue;
          }
          elimination = { ...value, label, rowIndex };
          continue;
        }
        if (fact.value < 0) {
          reset();
          continue;
        }
        if (!Object.keys(d).length || sameDimensions(d, qualifiers)) {
          const sum = branches.reduce((sum, b) => sum + b.fact.value, 0);
          const difference = fact.value - sum - (elimination?.fact.value ?? 0);
          const bound = branches.reduce(
            (sum, b) => sum + halfUnit(b.fact)!,
            halfUnit(fact)! + (elimination ? halfUnit(elimination.fact)! : 0)
          );
          const unique =
            new Set(branches.map((b) => factKey(b.fact))).size === branches.length &&
            new Set(branches.map((b) => b.label)).size === branches.length;
          if (
            branches.length >= 2 &&
            branches.length <= 20 &&
            unique &&
            branches.every((b) => b.column === value.column) &&
            revenueRow.test(label) &&
            fact.value === period.metrics.revenue &&
            (!omitted.length || elimination) &&
            Math.abs(difference) <= bound &&
            Math.abs(difference) <= fact.value * 0.001
          ) {
            const source = (
              entry: Branch & { rowIndex: number }
            ): NonNullable<RevenueSegment["revenueSource"]> => ({
              sourceUrl: filing.sourceUrl,
              accession: filing.accession,
              filedAt: filing.filedAt,
              startDate: period.startDate,
              endDate: period.endDate,
              currency: entry.fact.currency,
              tag: entry.fact.tag,
              dimensions: entry.fact.context.dimensions,
              value: entry.fact.value,
              decimals: entry.fact.decimals,
              tableLabel: entry.label,
              columnIndex: entry.column,
              rowIndex: entry.rowIndex
            });
            const segments: RevenueSegment[] = branches.map((b) => ({
              id: `reported-${axis}-${b.fact.context.dimensions[axis]}`.replace(
                /[^a-zA-Z0-9_-]/g,
                "-"
              ),
              label: b.label,
              revenue: b.fact.value,
              revenueSource: source(b)
            }));
            const adjustments: RevenueSegment[] = elimination
              ? [
                  {
                    id: "reported-intersegment-eliminations",
                    label: elimination.label,
                    revenue: elimination.fact.value,
                    revenueSource: source(elimination)
                  }
                ]
              : [];
            if (difference)
              adjustments.push({
                id: "source-rounding",
                label: "Source rounding",
                revenue: difference
              });
            const next: PeriodV2 = {
              ...period,
              segments,
              segmentSourceUrl: filing.sourceUrl,
              segmentBasis: elimination
                ? "Reported business-segment revenue includes internal sales. The filing's explicit intersegment elimination is shown separately to reconcile to consolidated revenue; it is not allocated or estimated."
                : "Reported business revenue from the total column of one source-table classification. Cross-axis interior cells are excluded to avoid double counting.",
              businessBreakdownSource: {
                method: "statement-revenue-matrix",
                tableIndex,
                sourceUrl: filing.sourceUrl,
                accession: filing.accession,
                revenueTag: fact.tag,
                revenue: fact.value,
                revenueDecimals: fact.decimals,
                axis,
                qualifiers,
                columnIndex: value.column,
                rowIndex,
                totalLabel: label,
                omittedSubtotals: omitted
              },
              revenueAdjustments: adjustments.length ? adjustments : undefined,
              coverage: { ...period.coverage, segments: true }
            };
            if (businessPeriod(next)) {
              next.coverage.sankey = !!flowPeriod(next);
              return next;
            }
          } else if (
            branches.length >= 2 &&
            branches.length <= 20 &&
            unique &&
            !elimination &&
            !omitted.length &&
            sameDimensions(d, qualifiers) &&
            Object.keys(qualifiers).length &&
            /^total segment (?:revenues?|sales)$/i.test(label) &&
            branches.every((b) => b.column === value.column) &&
            Math.abs(fact.value - sum) <= bound &&
            Math.abs(fact.value - sum) <= period.metrics.revenue! * 0.001
          ) {
            omitted = [
              {
                label,
                tag: fact.tag,
                dimensions: d,
                value: fact.value,
                decimals: fact.decimals,
                columnIndex: value.column,
                rowIndex
              }
            ];
            continue;
          }
          reset();
        } else if (/^(?:total|subtotal)\b/i.test(label) || omitted.length || elimination) reset();
        else if (isBusinessCategory(axis, d[axis], label))
          branches.push({ ...value, label, rowIndex });
        else reset();
      }
    }
  }
}

/** Read row totals of a product-by-segment matrix. Every branch and the explicit
 * total must occupy the same source column and share one classification/scope.
 * Interior cross-axis facts never enter a partition; no subsets or residuals
 * are searched to obtain a desired total. Aligned column-headed tables use the
 * same period, classification, scope and precision checks.
 */
export function enrichMatrixBusinessPeriods(
  html: string,
  identity: CatalogCompany,
  filing: SecFiling,
  existing: PeriodV2[],
  parsed: ParsedFiling
): PeriodV2[] {
  // A registered issuer schema stays fail-closed when its classifications change.
  if (businessRules.some((r) => r.cik === identity.cik)) return [];
  const url = new URL(filing.sourceUrl);
  if (
    !/^\d{10}$/.test(identity.cik) ||
    url.origin !== "https://www.sec.gov" ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(
      `/Archives/edgar/data/${Number(identity.cik)}/${filing.accession.replaceAll("-", "")}/`
    ) ||
    parsed.facts.some((f) => Number(f.context.cik) !== Number(identity.cik))
  )
    throw new Error("Business matrix source identity mismatch.");
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  if (tables.length > 5000) throw new Error("Statement table count exceeds safe limits.");
  const output: PeriodV2[] = [];
  for (const period of existing) {
    if (
      period.coverage.segments ||
      period.accession !== filing.accession ||
      period.sourceUrl !== filing.sourceUrl ||
      period.filedAt !== filing.filedAt ||
      period.displayCurrency !== "USD" ||
      period.reportingCurrency !== "USD" ||
      (period.metrics.revenue ?? 0) <= 0 ||
      period.metricSources.revenue?.method !== "reported" ||
      period.revenueAdjustments?.length
    )
      continue;
    const facts = parsed.facts.filter(
      (f) =>
        f.context.start === period.startDate &&
        f.context.end === period.endDate &&
        f.currency === "USD" &&
        !f.context.typed &&
        Number.isFinite(f.value)
    );
    const groups = new Map<string, XbrlFact[]>();
    for (const f of facts) groups.set(factKey(f), [...(groups.get(factKey(f)) ?? []), f]);
    const best = new Map([...groups].map(([key, copies]) => [key, precise(copies)]));
    const refs = new Map(facts.map((f) => [`${f.tag}|${f.context.id}`, f]));
    const consolidated = primaryRevenue(tables, period, refs, best);
    let selected: PeriodV2 | undefined;
    for (const [tableIndex, [table]] of tables.entries()) {
      if (
        table.length > 512000 ||
        /<table\b/i.test(table.slice(6)) ||
        /rowspan=["'](?:[2-9]|\d{2,})["']/i.test(table)
      )
        continue;
      const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)];
      if (rows.length > 500) continue;
      selected = readBusinessRows(rows, tableIndex, period, filing, refs, best);
      if (!selected)
        selected = readBusinessColumns(rows, tableIndex, period, filing, refs, best, consolidated);
      if (selected) break;
    }
    if (selected) output.push(selected);
  }
  return output;
}
