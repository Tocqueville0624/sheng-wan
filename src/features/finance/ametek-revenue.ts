import type {
  AmetekBusinessProof,
  RevenueSegment,
  ServiceRevenueCell,
  ServiceRevenueRow
} from "./types";
import type { PeriodV2 } from "./v2-types";
import { sameDimensions } from "./business-rules";
import { originalThousandDollarRows } from "./original-revenue-rows";

export const ametekRevenueBasis =
  "Reported Electronic Instruments Group (EIG) and Electromechanical Group (EMG) net sales from the original filing's complete closing business row. Original quarter, comparative and year-to-date columns remain distinct and reconcile to independent primary net sales. Geography, product and transfer-timing intersections are not counted again; no corporate revenue or business gross profit is estimated.";
export class AmetekRevenueProofError extends Error {}
function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new AmetekRevenueProofError(reason);
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const index = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;
const first = (r: ServiceRevenueRow) => r.cells[0]?.label;
const current = (c: ServiceRevenueCell, p: PeriodV2) =>
  c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate;
const months = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const dayCaption = (p: PeriodV2) =>
  `${months[Number(p.endDate.slice(5, 7))]} ${Number(p.endDate.slice(8))},`;
const inside = (
  a: { columnIndex: number; span: number },
  b: { columnIndex: number; span: number }
) => a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
const headings = (rows: ServiceRevenueRow[]) =>
  rows.flatMap((r) => r.cells.map((c) => ({ ...c, rowIndex: r.rowIndex })));

/** The original primary year column, under its own annual/three-month caption. */
function primarySlot(rows: ServiceRevenueRow[], row: ServiceRevenueRow, p: PeriodV2) {
  const headers = headings(rows).filter((c) => !c.fact && c.rowIndex < row.rowIndex);
  const years = headers.filter((c) => /^20\d{2}$/.test(c.label));
  const temporal = headers.filter((c) =>
    p.kind === "annual"
      ? /^Year Ended December 31,?$/i.test(c.label)
      : c.label.toLowerCase() === `Three Months Ended ${dayCaption(p)}`.toLowerCase()
  );
  const singleQ1 =
    p.kind === "quarterly" &&
    p.fiscalQuarter === 1 &&
    temporal.length === 1 &&
    headers.filter((c) => /Months Ended/i.test(c.label)).length === 1 &&
    years.length === 2 &&
    years[0].rowIndex === years[1].rowIndex &&
    Number(years[0].label) - Number(years[1].label) === 1 &&
    years[0].columnIndex < years[1].columnIndex;
  const slots = years
    .filter(
      (y) =>
        y.label === p.endDate.slice(0, 4) &&
        temporal.some((t) => t.rowIndex < y.rowIndex && (inside(y, t) || singleQ1))
    )
    .flatMap((y) => {
      const cells = row.cells.filter((c) => c.fact && inside(c, y));
      return cells.length === 1 && current(cells[0], p) ? [cells[0]] : [];
    });
  demand(
    slots.length === 1 && row.cells.filter((c) => current(c, p)).length === 1,
    "Missing or ambiguous original primary period column"
  );
  return slots[0].fact!;
}

const classifications = [
  {
    heading: "EIG",
    label: "Electronic Instruments",
    member: "ame:ElectronicInstrumentsGroupMember"
  },
  { heading: "EMG", label: "Electromechanical", member: "ame:ElectromechanicalGroupMember" },
  { heading: "Total" }
] as const;
type Temporal = { cell: ReturnType<typeof headings>[number]; startDate: string; endDate: string };
function temporalGroups(proof: AmetekBusinessProof, p: PeriodV2): Temporal[] {
  const cells = headings(proof.headerRows);
  demand(
    proof.headerRows.length >= 2 && proof.headerRows.length <= 20 && cells.every((c) => !c.fact),
    "Invalid original business headings"
  );
  const groups: Temporal[] = [];
  for (const cell of cells) {
    if (!cell.label || ["EIG", "EMG", "Total", "(In thousands)"].includes(cell.label)) continue;
    if (p.kind === "annual" && /^20\d{2}$/.test(cell.label)) {
      groups.push({ cell, startDate: cell.label + "-01-01", endDate: cell.label + "-12-31" });
      continue;
    }
    const match = cell.label.match(
      /^(Three|Six|Nine) months ended (March|June|September|December) (\d{1,2}), (20\d{2})$/i
    );
    demand(p.kind === "quarterly" && match, "Changed original business period caption");
    const month = months.findIndex((m) => m.toLowerCase() === match[2].toLowerCase());
    const count = ({ three: 3, six: 6, nine: 9 } as Record<string, number>)[match[1].toLowerCase()];
    demand(
      month % 3 === 0 && (count === 3 || count === month),
      "Unreviewed cumulative business duration"
    );
    const endDate = `${match[4]}-${String(month).padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    const startDate = `${match[4]}-${String(month - count + 1).padStart(2, "0")}-01`;
    demand(
      date(endDate) &&
        date(startDate) &&
        Number(match[3]) === new Date(Date.UTC(Number(match[4]), month, 0)).getUTCDate(),
      "Invalid original business caption date"
    );
    groups.push({ cell, startDate, endDate });
  }
  demand(
    groups.length >= 1 &&
      groups.length <= 2 &&
      new Set(groups.map((g) => g.startDate + "|" + g.endDate)).size === groups.length,
    "Duplicate or missing original business period groups"
  );
  demand(
    groups.filter((g) => g.startDate === p.startDate && g.endDate === p.endDate).length === 1,
    "Business date caption differs from selected period"
  );
  return groups;
}

export function ametekRevenueSegments(p: PeriodV2, proof: AmetekBusinessProof): RevenueSegment[] {
  const tag = p.metricSources.revenue?.tag;
  demand(
    p.accession && /^\d{10}-\d{2}-\d{6}$/.test(p.accession),
    "Missing original AMETEK accession"
  );
  const source = new URL(p.sourceUrl);
  demand(
    source.origin === "https://www.sec.gov" &&
      !source.username &&
      !source.password &&
      source.pathname.startsWith(
        `/Archives/edgar/data/1037868/${p.accession.replaceAll("-", "")}/`
      ) &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      p.metricSources.revenue?.method === "reported" &&
      /^us-gaap:RevenueFromContractWithCustomer(?:Including|Excluding)AssessedTax$/.test(
        tag ?? ""
      ) &&
      p.metricSources.revenue.sourceUrl === p.sourceUrl &&
      p.metricSources.revenue.accession === p.accession &&
      p.metricSources.revenue.filedAt === p.filedAt &&
      proof.ruleId === "ame-original-closing-sales-v1" &&
      date(proof.reportDate) &&
      date(p.filedAt) &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt &&
      proof.originalFiscalYear === Number(proof.reportDate.slice(0, 4)) &&
      (p.kind === "annual" ? /^10-K(?:\/A)?$/ : /^10-Q(?:\/A)?$/).test(proof.form) &&
      index(proof.tableIndex) &&
      index(proof.primary.tableIndex) &&
      proof.tableIndex !== proof.primary.tableIndex,
    "Foreign or invalid original AMETEK business source"
  );
  const month = Number(p.endDate.slice(5, 7)),
    year = p.endDate.slice(0, 4);
  demand(
    p.fiscalYear === Number(year) &&
      date(p.startDate) &&
      date(p.endDate) &&
      (p.kind === "annual"
        ? p.startDate === year + "-01-01" && p.endDate === year + "-12-31"
        : month % 3 === 0 &&
          p.fiscalQuarter === month / 3 &&
          p.startDate === `${year}-${String(month - 2).padStart(2, "0")}-01` &&
          Number(p.endDate.slice(8)) === new Date(Date.UTC(Number(year), month, 0)).getUTCDate()),
    "Fiscal label differs from the original calendar period"
  );
  demand(
    Array.isArray(proof.units) &&
      proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Invalid original USD units"
  );
  originalThousandDollarRows(
    [...proof.headerRows, proof.revenue].sort((a, b) => a.rowIndex - b.rowIndex),
    proof.units,
    "0001037868"
  );
  originalThousandDollarRows(
    [...proof.primary.headerRows, proof.primary.revenue, proof.primary.tax].sort(
      (a, b) => a.rowIndex - b.rowIndex
    ),
    proof.units,
    "0001037868"
  );
  demand(
    /^AMETEK, Inc\. Consolidated Statement of Income$/i.test(proof.primary.title) &&
      first(proof.primary.revenue) === "Net sales" &&
      first(proof.primary.tax) === "Provision for income taxes" &&
      proof.primary.tax.rowIndex > proof.primary.revenue.rowIndex,
    "Missing independent original AMETEK primary statement"
  );
  const revenue = primarySlot(proof.primary.headerRows, proof.primary.revenue, p),
    tax = primarySlot(proof.primary.headerRows, proof.primary.tax, p);
  demand(
    revenue.tag === tag &&
      revenue.value === p.metrics.revenue &&
      !Object.keys(revenue.dimensions).length &&
      tax.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
      !Object.keys(tax.dimensions).length &&
      tax.value === p.metrics.incomeTax,
    "Original primary totals differ from reported consolidated measures"
  );
  demand(
    first(proof.revenue) === "Consolidated net sales" &&
      !proof.revenue.cells[0].fact &&
      proof.revenue.cells.slice(1).every((c) => c.fact || /^(?:\$|[—–-])?$/.test(c.label)) &&
      proof.headerRows.every((r) => r.rowIndex < proof.revenue.rowIndex) &&
      proof.primary.headerRows.every((r) => r.cells.every((c) => !c.fact)),
    "Missing complete original closing business row"
  );
  const groups = temporalGroups(proof, p),
    headers = headings(proof.headerRows),
    used = new Set<number>();
  const selected: { heading: string; label: string; cell: ServiceRevenueCell }[] = [];
  for (const group of groups) {
    const columns = headers.filter(
      (c) =>
        c.rowIndex > group.cell.rowIndex &&
        c.label &&
        c.label !== "(In thousands)" &&
        inside(c, group.cell)
    );
    demand(
      canonical(columns.map((c) => c.label)) === canonical(["EIG", "EMG", "Total"]) &&
        new Set(columns.map((c) => c.rowIndex)).size === 1,
      "Changed or incomplete original business columns"
    );
    const facts: ServiceRevenueCell[] = [];
    for (const [i, column] of columns.entries()) {
      const cells = proof.revenue.cells.filter((c) => inside(c, column));
      const amounts = cells.filter((c) => c.fact);
      demand(
        amounts.length === 1 && cells.every((c) => c.fact || /^(?:\$|[—–-])?$/.test(c.label)),
        "Extra, missing or unresolved business amount"
      );
      const cell = amounts[0],
        f = cell.fact!,
        classification = classifications[i];
      demand(
        !used.has(cell.columnIndex) &&
          f.tag === tag &&
          f.value >= 0 &&
          f.startDate === group.startDate &&
          f.endDate === group.endDate &&
          sameDimensions(
            f.dimensions,
            "member" in classification
              ? { "us-gaap:StatementBusinessSegmentsAxis": classification.member }
              : {}
          ),
        "Business amount differs from its original heading, dates or classification"
      );
      used.add(cell.columnIndex);
      facts.push(cell);
      if (
        group.startDate === p.startDate &&
        group.endDate === p.endDate &&
        "label" in classification
      )
        selected.push({ heading: classification.heading, label: classification.label, cell });
    }
    demand(
      facts[0].fact!.value + facts[1].fact!.value === facts[2].fact!.value,
      "Original complete businesses do not equal their reported total"
    );
    if (group.startDate === p.startDate && group.endDate === p.endDate)
      demand(
        facts[2].fact!.value === revenue.value,
        "Closing business total differs from independent primary revenue"
      );
  }
  demand(
    proof.revenue.cells.filter((c) => c.fact).length === used.size && selected.length === 2,
    "Unaccounted original business monetary columns"
  );
  return selected.map(({ heading, label, cell }) => ({
    id: `reported-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    label,
    revenue: cell.fact!.value,
    revenueSource: {
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      startDate: p.startDate,
      endDate: p.endDate,
      currency: "USD",
      tag: cell.fact!.tag,
      dimensions: cell.fact!.dimensions,
      value: cell.fact!.value,
      decimals: cell.fact!.decimals,
      tableLabel: heading,
      rowLabel: first(proof.revenue),
      rowIndex: proof.revenue.rowIndex,
      columnIndex: cell.columnIndex
    }
  }));
}

export function ametekRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.ametekRevenue;
    demand(
      s?.method === "reviewed-ametek-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.tableIndex === proof.tableIndex &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.revenueDecimals === -3 &&
        s.totalLabel === "Consolidated net sales" &&
        !s.axis &&
        !s.albemarleRevenue &&
        !s.productPortfolios &&
        !s.serviceRevenueRows &&
        !s.externalCustomerColumns &&
        !s.omittedSubtotals.length &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === ametekRevenueBasis,
      "Invalid original AMETEK proof envelope"
    );
    demand(
      canonical(p.segments) === canonical(ametekRevenueSegments(p, proof)),
      "Original AMETEK businesses were altered"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original AMETEK proof";
  }
}
