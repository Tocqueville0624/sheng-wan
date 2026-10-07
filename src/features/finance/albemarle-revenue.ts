import type {
  AlbemarleBusinessProof,
  RevenueSegment,
  ServiceRevenueCell,
  ServiceRevenueRow
} from "./types";
import type { PeriodV2 } from "./v2-types";
import { sameDimensions } from "./business-rules";
import { OriginalRevenueRowsError, originalThousandDollarRows } from "./original-revenue-rows";

export const albemarleRevenueBasis =
  "Reported Albemarle business revenue under the original filing's classification. Every original business row or column, corporate amount, blank and subtotal is checked against the independent consolidated net-sales row. No business revenue or gross profit is estimated; a blank remains unfilled.";
export class AlbemarleRevenueProofError extends Error {}
function demand(v: unknown, reason: string): asserts v {
  if (!v) throw new AlbemarleRevenueProofError(reason);
}
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const integer = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;
const operating = { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" };
const segment = (member: string) => ({
  ...operating,
  "us-gaap:StatementBusinessSegmentsAxis": `alb:${member}Member`
});
const current = (c: ServiceRevenueCell, p: PeriodV2) =>
  c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate;
function physicalRows(rows: ServiceRevenueRow[], units: AlbemarleBusinessProof["units"]) {
  try {
    originalThousandDollarRows(rows, units, "0000915913");
  } catch (e) {
    if (e instanceof OriginalRevenueRowsError) throw new AlbemarleRevenueProofError(e.message);
    throw e;
  }
}

const month = (p: PeriodV2) =>
  (
    ({ "03": "March", "06": "June", "09": "September", "12": "December" }) as Record<string, string>
  )[p.endDate.slice(5, 7)];
function periodSlot(headers: ServiceRevenueRow[], row: ServiceRevenueRow, p: PeriodV2) {
  const entries = headers
    .flatMap((r) => r.cells.map((c) => ({ ...c, rowIndex: r.rowIndex })))
    .filter((c) => !c.fact && c.rowIndex < row.rowIndex);
  const years = entries.filter((c) => c.label === p.endDate.slice(0, 4));
  const temporal = entries.filter((c) =>
    p.kind === "annual"
      ? /^Year Ended December 31,?$/.test(c.label)
      : c.label === `Three Months Ended ${month(p)} ${Number(p.endDate.slice(8))},`
  );
  const yearHeadings = entries.filter((c) => /^20\d{2}$/.test(c.label));
  // Original Q1 captions are centered over part of two year columns. They are
  // not a spanning group. Only this explicit single-quarter, two-year layout
  // can corroborate the comparative column outside the centered caption.
  const singleQ1 =
    p.kind === "quarterly" &&
    p.fiscalQuarter === 1 &&
    p.startDate.endsWith("-01-01") &&
    p.endDate.endsWith("-03-31") &&
    temporal.length === 1 &&
    entries.filter((c) => /Months Ended/.test(c.label)).length === 1 &&
    yearHeadings.length === 2 &&
    yearHeadings[0].rowIndex === yearHeadings[1].rowIndex &&
    Number(yearHeadings[0].label) - Number(yearHeadings[1].label) === 1 &&
    yearHeadings[0].columnIndex < yearHeadings[1].columnIndex;
  const matches = years
    .filter((y) =>
      temporal.some(
        (t) =>
          (t.rowIndex < y.rowIndex &&
            y.columnIndex >= t.columnIndex &&
            y.columnIndex + y.span <= t.columnIndex + t.span) ||
          (p.kind === "annual" &&
            t.rowIndex === y.rowIndex &&
            t.columnIndex === 0 &&
            t.columnIndex + t.span <= y.columnIndex) ||
          (singleQ1 && t.rowIndex < y.rowIndex)
      )
    )
    .flatMap((y) => {
      const values = row.cells.filter(
        (c) =>
          c.fact &&
          c.columnIndex >= y.columnIndex &&
          c.columnIndex + c.span <= y.columnIndex + y.span
      );
      return values.length === 1 && current(values[0], p) ? [{ header: y, cell: values[0] }] : [];
    });
  demand(
    matches.length === 1 && row.cells.filter((c) => current(c, p)).length === 1,
    "Missing or ambiguous source period column"
  );
  return matches[0];
}
const first = (r: ServiceRevenueRow) => r.cells[0]?.label;
const monetary = (r: ServiceRevenueRow, p: PeriodV2) => r.cells.filter((c) => current(c, p));
function scopeFor(label: string, d: Record<string, string>) {
  if (label === "Energy Storage") return sameDimensions(d, segment("EnergyStorage"));
  if (label === "Specialties") return sameDimensions(d, segment("Specialties"));
  if (label === "Ketjen") return sameDimensions(d, segment("Ketjen"));
  if (label === "Lithium") return sameDimensions(d, segment("Lithium"));
  if (label === "Catalysts") return sameDimensions(d, segment("Catalysts"));
  if (label === "Bromine Specialties") return sameDimensions(d, segment("BromineSpecialties"));
  if (label === "Bromine")
    return (
      sameDimensions(d, segment("Bromine")) || sameDimensions(d, segment("BromineSpecialties"))
    );
  if (label === "All Other")
    return (
      sameDimensions(d, {
        "srt:ConsolidationItemsAxis": "us-gaap:MaterialReconcilingItemsMember"
      }) ||
      sameDimensions(d, {
        "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
      })
    );
  if (label === "Corporate" || label === "Corporate and all other")
    return sameDimensions(d, { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" });
  return false;
}
export function albemarleRevenueSegments(
  p: PeriodV2,
  proof: AlbemarleBusinessProof
): RevenueSegment[] {
  demand(typeof p.accession === "string", "Missing original accession");
  demand(
    p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      /^\d{10}-\d{2}-\d{6}$/.test(p.accession) &&
      p.sourceUrl.startsWith(
        `https://www.sec.gov/Archives/edgar/data/915913/${p.accession.replaceAll("-", "")}/`
      ) &&
      !new URL(p.sourceUrl).username &&
      !new URL(p.sourceUrl).password &&
      p.metricSources.revenue?.method === "reported" &&
      p.metricSources.revenue.tag === "us-gaap:Revenues" &&
      proof.ruleId === "alb-original-revenue-section-v1" &&
      date(proof.reportDate) &&
      proof.reportDate <= p.filedAt &&
      proof.reportDate >= p.endDate &&
      /^(10-K|10-Q)(\/A)?$/.test(proof.form) &&
      integer(proof.tableIndex) &&
      integer(proof.primary.tableIndex) &&
      proof.primary.tableIndex !== proof.tableIndex,
    "Foreign or invalid original business source"
  );
  demand(
    p.fiscalYear === Number(p.endDate.slice(0, 4)) &&
      (p.kind !== "annual" || p.endDate.endsWith("-12-31")),
    "Fiscal label differs from the original calendar-year statement"
  );
  demand(
    proof.originalFiscalYear === Number(proof.reportDate.slice(0, 4)) ||
      (proof.originalFiscalYear === 2021 &&
        proof.reportDate === "2022-12-31" &&
        p.accession === "0000915913-23-000039"),
    "Unreviewed source fiscal metadata"
  );
  demand(
    Array.isArray(proof.units) &&
      proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Invalid USD units"
  );
  physicalRows(
    [...proof.headerRows, ...proof.rows].sort((a, b) => a.rowIndex - b.rowIndex),
    proof.units
  );
  physicalRows(
    [...proof.primary.headerRows, proof.primary.revenue, proof.primary.tax].sort(
      (a, b) => a.rowIndex - b.rowIndex
    ),
    proof.units
  );
  demand(
    /^ALBEMARLE CORPORATION (?:AND SUBSIDIARIES )?(?:CONDENSED )?CONSOLIDATED STATEMENTS OF (?:INCOME|\(LOSS\) INCOME|INCOME \(LOSS\)|LOSS|OPERATIONS)$/i.test(
      proof.primary.title
    ) &&
      first(proof.primary.revenue) === "Net sales" &&
      proof.primary.tax.rowIndex > proof.primary.revenue.rowIndex,
    "Missing independent primary statement"
  );
  const revenue = periodSlot(proof.primary.headerRows, proof.primary.revenue, p).cell.fact!,
    tax = periodSlot(proof.primary.headerRows, proof.primary.tax, p).cell.fact!;
  demand(
    revenue.tag === "us-gaap:Revenues" &&
      revenue.value === p.metrics.revenue &&
      !Object.keys(revenue.dimensions).length &&
      tax.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
      !Object.keys(tax.dimensions).length,
    "Missing independent consolidated monetary anchors"
  );
  const branches: { label: string; row: ServiceRevenueRow; cell: ServiceRevenueCell }[] = [];
  if (proof.layout === "columns") {
    demand(
      proof.rows.length === 1 && /^Net sales(?: \(a\))?$/.test(first(proof.rows[0]) ?? ""),
      "Incomplete original horizontal revenue row"
    );
    const row = proof.rows[0];
    const section = proof.headerRows.filter((r) => r.rowIndex < row.rowIndex).at(-1);
    demand(
      section &&
        section.cells.filter((c) => c.label).length === 1 &&
        section.cells.some(
          (c) =>
            c.label ===
            (p.kind === "annual"
              ? `Year Ended December 31, ${p.endDate.slice(0, 4)}`
              : `Three Months Ended ${month(p)} ${Number(p.endDate.slice(8))}, ${p.endDate.slice(0, 4)}`)
        ),
      "Wrong original horizontal period section"
    );
    const header = proof.headerRows.find(
      (r) =>
        canonical(r.cells.filter((c) => c.label).map((c) => c.label)) ===
        canonical(["Energy Storage", "Specialties", "Ketjen", "Total Segments"])
    );
    demand(header, "Missing complete original business headings");
    const amounts = monetary(row, p);
    demand(
      amounts.length === 4 && row.cells.filter((c) => c.fact).length === 4,
      "Extra or missing business monetary columns"
    );
    for (const [index, label] of [
      "Energy Storage",
      "Specialties",
      "Ketjen",
      "Total Segments"
    ].entries()) {
      const heading = header.cells.find((c) => c.label === label)!;
      const values = amounts.filter(
        (c) =>
          c.columnIndex >= heading.columnIndex &&
          c.columnIndex + c.span <= heading.columnIndex + heading.span
      );
      demand(values.length === 1, "Business amount differs from its physical heading");
      const cell = values[0],
        f = cell.fact!;
      demand(
        f.tag === "us-gaap:Revenues" &&
          f.value >= 0 &&
          (index === 3
            ? sameDimensions(f.dimensions, operating) && f.value === revenue.value
            : scopeFor(label, f.dimensions)),
        "Unreviewed business or segment aggregate scope"
      );
      if (index < 3) branches.push({ label, row, cell });
    }
  } else {
    demand(
      proof.layout === "rows" && proof.rows.length >= 4 && proof.rows.length <= 8,
      "Incomplete original vertical revenue section"
    );
    const total = proof.rows.at(-1)!;
    demand(first(total) === "Total net sales", "Missing closing original consolidated total");
    const slot = periodSlot(proof.headerRows, total, p);
    const closing = slot.cell.fact!;
    demand(
      closing.tag === revenue.tag &&
        closing.value === revenue.value &&
        !Object.keys(closing.dimensions).length,
      "Business closing total is not consolidated net sales"
    );
    let subtotal = false;
    const labels = proof.rows.slice(0, -1).map(first).filter(Boolean);
    const profiles = [
      ["Energy Storage", "Specialties", "Total segment net sales", "Corporate and all other"],
      ["Energy Storage", "Specialties", "Ketjen", "Total segment net sales", "All Other"],
      ["Energy Storage", "Specialties", "Ketjen"],
      ...["Bromine", "Bromine Specialties"].flatMap((b) => [
        ["Lithium", b, "Catalysts", "All Other", "Corporate"],
        ["Lithium", b, "Catalysts", "All Other"],
        ["Lithium", b, "Catalysts"]
      ])
    ];
    demand(
      profiles.some((profile) => canonical(profile) === canonical(labels)),
      "Changed or incomplete original business classification"
    );
    for (const row of proof.rows.slice(0, -1)) {
      const label = first(row)!;
      if (!label) {
        demand(
          row.cells.every((c) => !c.fact && !c.label),
          "Hidden source value in an empty row"
        );
        continue;
      }
      const values = monetary(row, p);
      demand(values.length <= 1, "Duplicate current-period monetary row");
      if (!values.length) {
        const cells = row.cells.filter(
          (c) =>
            c.columnIndex >= slot.header.columnIndex &&
            c.columnIndex + c.span <= slot.header.columnIndex + slot.header.span
        );
        demand(
          (label === "Corporate" || label === "All Other") &&
            cells.length >= 1 &&
            cells.every((c) => !c.fact && /^(?:\$|[—–-])?$/.test(c.label)),
          "An unavailable business value cannot become a zero"
        );
        continue;
      }
      const cell = values[0],
        f = cell.fact!;
      demand(
        cell.columnIndex >= slot.header.columnIndex &&
          cell.columnIndex + cell.span <= slot.header.columnIndex + slot.header.span &&
          f.tag === revenue.tag &&
          f.value >= 0,
        "Business row differs from closing period column"
      );
      if (label === "Total segment net sales") {
        demand(
          !subtotal &&
            (branches.length === 2 || branches.length === 3) &&
            sameDimensions(f.dimensions, operating) &&
            f.value === branches.reduce((sum, b) => sum + b.cell.fact!.value, 0),
          "Invalid or double-counted segment subtotal"
        );
        subtotal = true;
        continue;
      }
      demand(scopeFor(label, f.dimensions), "Unreviewed original business dimensions");
      branches.push({ label, row, cell });
    }
  }
  demand(
    branches.length >= 3 &&
      new Set(branches.map((b) => b.label)).size === branches.length &&
      branches.reduce((sum, b) => sum + b.cell.fact!.value, 0) === revenue.value,
    "Complete reported businesses do not equal consolidated revenue"
  );
  const accession = p.accession;
  return branches.map(({ label, row, cell }) => ({
    id: `reported-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    label,
    revenue: cell.fact!.value,
    revenueSource: {
      sourceUrl: p.sourceUrl,
      accession,
      filedAt: p.filedAt,
      startDate: p.startDate,
      endDate: p.endDate,
      currency: "USD",
      tag: cell.fact!.tag,
      dimensions: cell.fact!.dimensions,
      value: cell.fact!.value,
      decimals: cell.fact!.decimals,
      tableLabel: label,
      rowLabel: first(row),
      rowIndex: row.rowIndex,
      columnIndex: cell.columnIndex
    }
  }));
}
export function albemarleRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const source = p.businessBreakdownSource,
      proof = source?.albemarleRevenue;
    demand(
      source?.method === "reviewed-albemarle-revenue" &&
        proof &&
        source.ruleId === proof.ruleId &&
        source.tableIndex === proof.tableIndex &&
        source.totalTableIndex === proof.primary.tableIndex &&
        source.sourceUrl === p.sourceUrl &&
        source.accession === p.accession &&
        source.revenue === p.metrics.revenue &&
        source.revenueTag === "us-gaap:Revenues" &&
        source.totalLabel === "Net sales" &&
        source.revenueDecimals === -3 &&
        !source.axis &&
        !source.productPortfolios &&
        !source.serviceRevenueRows &&
        !source.externalCustomerColumns &&
        !source.omittedSubtotals.length &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === albemarleRevenueBasis,
      "Invalid original business proof envelope"
    );
    demand(
      canonical(p.segments) === canonical(albemarleRevenueSegments(p, proof)),
      "Original reported branches were altered"
    );
  } catch (e) {
    if (e instanceof AlbemarleRevenueProofError) return e.message;
    return "Malformed original Albemarle proof";
  }
}
