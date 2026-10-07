import type {
  ChurchDwightBusinessProof,
  RevenueSegment,
  ServiceRevenueCell,
  ServiceRevenueRow
} from "./types";
import type { PeriodV2 } from "./v2-types";
import { sameDimensions } from "./business-rules";
import {
  originalExactMillionDollars,
  originalReviewedMillionDollarRows
} from "./original-revenue-rows";

export const churchDwightRevenueBasis =
  "Reported Household Products and Personal Care Products partition Consumer Domestic; Consumer International and Specialty Products Division (SPD) retain their reported business totals. Every original comparative and year-to-date column reconciles to its domestic subtotal, consolidated total and independent primary net sales. Domestic subtotals are not counted twice. Original million-dollar display and declared precision are retained; no business gross profit or missing classification is estimated.";
export class ChurchDwightRevenueProofError extends Error {}
function demand(v: unknown, reason: string): asserts v {
  if (!v) throw new ChurchDwightRevenueProofError(reason);
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
const index = (n: number) => Number.isInteger(n) && n >= 0 && n < 5000;
const label = (r: ServiceRevenueRow) => r.cells[0]?.label;
const inside = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
const months = ["March", "June", "September", "December"];
const operating = { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" };
const domestic = {
  ...operating,
  "us-gaap:StatementBusinessSegmentsAxis": "chd:ConsumerDomesticMember"
};
const classifications = [
  {
    label: "Household Products",
    dimensions: { ...domestic, "srt:ProductOrServiceAxis": "chd:HouseholdProductsMember" }
  },
  {
    label: "Personal Care Products",
    dimensions: { ...domestic, "srt:ProductOrServiceAxis": "chd:PersonalCareProductsMember" }
  },
  { label: "Total Consumer Domestic", dimensions: domestic },
  {
    label: "Total Consumer International",
    dimensions: {
      ...operating,
      "us-gaap:StatementBusinessSegmentsAxis": "chd:ConsumerInternationalMember"
    }
  },
  {
    label: "Total SPD",
    dimensions: {
      ...operating,
      "us-gaap:StatementBusinessSegmentsAxis": "chd:SpecialtyProductsDivisionMember"
    }
  },
  { label: "Total Consolidated Net Sales", dimensions: {} }
] as const;
type Slot = { year: string; startDate: string; endDate: string; cell: ServiceRevenueCell };

/** Bind every physical monetary column to the unchanged visible year/date/duration
 * captions. Annual product headings use the independent primary annual caption. */
function calendarSlots(
  headers: ServiceRevenueRow[],
  row: ServiceRevenueRow,
  annual: boolean,
  primary = false
): Slot[] {
  demand(
    headers.length >= 1 &&
      headers.length <= 12 &&
      headers.every((r) => r.rowIndex < row.rowIndex && r.cells.every((c) => !c.fact)),
    "Invalid original temporal headings"
  );
  const cells = headers.flatMap((r) => r.cells.map((c) => ({ ...c, rowIndex: r.rowIndex })));
  const years = cells.filter((c) => /^20\d{2}$/.test(c.label));
  demand(
    years.length === (annual ? 3 : 2) || (!annual && years.length === 4),
    "Changed original comparative column count"
  );
  demand(new Set(years.map((c) => c.rowIndex)).size === 1, "Split original year headings");
  demand(
    cells.every(
      (c) =>
        !c.label ||
        /^20\d{2}$/.test(c.label) ||
        (annual
          ? /^Year Ended December 31,?$/i.test(c.label)
          : /^(?:Three|Six|Nine) Months Ended$/i.test(c.label) ||
            /^(?:March|June|September|December) \d{1,2},$/.test(c.label))
    ),
    "Unknown original temporal heading"
  );
  const durations = cells.filter((c) => /Months Ended/i.test(c.label));
  if (annual) {
    demand(
      years.every((y, i) => i === 0 || Number(years[i - 1].label) - Number(y.label) === 1) &&
        (primary
          ? cells.filter((c) => /^Year Ended December 31,?$/i.test(c.label)).length === 1
          : cells.every((c) => !c.label || /^20\d{2}$/.test(c.label))),
      "Changed original annual caption"
    );
  } else {
    demand(
      durations.length === (years.length === 4 ? 2 : 1) &&
        years.every((y, i) => i % 2 === 0 || Number(years[i - 1].label) - Number(y.label) === 1) &&
        (years.length !== 4 || years[0].label === years[2].label),
      "Changed original quarter/comparative groups"
    );
  }
  const used = new Set<number>();
  const slots = years.map((year): Slot => {
    const amounts = row.cells.filter((c) => c.fact && inside(c, year));
    demand(amounts.length === 1, "Missing or ambiguous original monetary column");
    const cell = amounts[0];
    used.add(cell.columnIndex);
    let startDate = year.label + "-01-01",
      endDate = year.label + "-12-31";
    if (annual && primary) {
      demand(
        cells.some(
          (c) =>
            /^Year Ended December 31,?$/i.test(c.label) &&
            c.rowIndex < year.rowIndex &&
            inside(year, c)
        ),
        "Annual year lies outside original primary caption"
      );
    }
    if (!annual) {
      const dates = cells.filter(
        (c) =>
          /^(?:March|June|September|December) \d{1,2},$/.test(c.label) &&
          c.rowIndex < year.rowIndex &&
          inside(year, c)
      );
      const temporal = durations.filter((c) => c.rowIndex < year.rowIndex && inside(year, c));
      demand(dates.length === 1 && temporal.length === 1, "Misaligned original quarter caption");
      const [monthName, day] = dates[0].label.replace(",", "").split(" ");
      const month = (months.indexOf(monthName) + 1) * 3;
      const count = ({ Three: 3, Six: 6, Nine: 9 } as Record<string, number>)[
        temporal[0].label.split(" ")[0]
      ];
      demand(
        month > 0 &&
          (count === 3 || count === month) &&
          Number(day) === new Date(Date.UTC(Number(year.label), month, 0)).getUTCDate(),
        "Unreviewed original quarter duration"
      );
      startDate = `${year.label}-${String(month - count + 1).padStart(2, "0")}-01`;
      endDate = `${year.label}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    demand(
      cell.fact!.startDate === startDate && cell.fact!.endDate === endDate,
      "Original context differs from its visible period caption"
    );
    return { year: year.label, startDate, endDate, cell };
  });
  demand(
    row.cells.filter((c) => c.fact).length === used.size &&
      new Set(slots.map((s) => s.startDate + "|" + s.endDate)).size === slots.length &&
      row.cells
        .slice(1)
        .every(
          (c, i) =>
            c.fact ||
            /^(?:\$)?$/.test(c.label) ||
            (c.label === ")" &&
              row.cells[i].fact &&
              row.cells[i].fact!.value < 0 &&
              /^\(/.test(row.cells[i].label) &&
              row.cells[i].columnIndex + row.cells[i].span === c.columnIndex)
        ),
    "Unaccounted original monetary column"
  );
  return slots;
}

export function churchDwightRevenueSegments(
  p: PeriodV2,
  proof: ChurchDwightBusinessProof
): RevenueSegment[] {
  const tag = p.metricSources.revenue?.tag;
  demand(p.accession && /^\d{10}-\d{2}-\d{6}$/.test(p.accession), "Missing original accession");
  const url = new URL(p.sourceUrl);
  demand(
    url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(`/Archives/edgar/data/313927/${p.accession.replaceAll("-", "")}/`) &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      p.metricSources.revenue?.method === "reported" &&
      tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" &&
      p.metricSources.revenue.sourceUrl === p.sourceUrl &&
      p.metricSources.revenue.accession === p.accession &&
      p.metricSources.revenue.filedAt === p.filedAt &&
      proof.ruleId === "chd-original-product-hierarchy-v1" &&
      date(proof.reportDate) &&
      date(p.filedAt) &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt &&
      proof.originalFiscalYear === Number(proof.reportDate.slice(0, 4)) &&
      (p.kind === "annual" ? /^10-K(?:\/A)?$/ : /^10-Q(?:\/A)?$/).test(proof.form) &&
      index(proof.tableIndex) &&
      index(proof.primary.tableIndex) &&
      proof.tableIndex !== proof.primary.tableIndex,
    "Foreign or invalid original Church & Dwight source"
  );
  const month = Number(p.endDate.slice(5, 7)),
    year = p.endDate.slice(0, 4);
  demand(
    date(p.startDate) &&
      date(p.endDate) &&
      p.fiscalYear === Number(year) &&
      (p.kind === "annual"
        ? p.startDate === year + "-01-01" && p.endDate === year + "-12-31"
        : month % 3 === 0 &&
          p.fiscalQuarter === month / 3 &&
          p.startDate === `${year}-${String(month - 2).padStart(2, "0")}-01`),
    "Changed original calendar fiscal period"
  );
  demand(
    proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length &&
      canonical(proof.rows.map(label)) === canonical(classifications.map((c) => c.label)) &&
      proof.rows.every((r, i) => i === 0 || r.rowIndex === proof.rows[i - 1].rowIndex + 1),
    "Changed or incomplete original product hierarchy"
  );
  originalReviewedMillionDollarRows(
    [...proof.headerRows, ...proof.rows],
    proof.units,
    "0000313927"
  );
  originalReviewedMillionDollarRows(
    [...proof.primary.headerRows, proof.primary.revenue, proof.primary.tax],
    proof.units,
    "0000313927"
  );
  demand(
    /^CHURCH & DWIGHT CO\., INC\. AND SUBSIDIARIES (?:CONDENSED )?CONSOL\s*IDATED STATEMENTS OF INCOME(?: \(LOSS\))?(?: \(Unaudited\))? \(In millions, except per share data\)$/i.test(
      proof.primary.title
    ) &&
      label(proof.primary.revenue) === "Net Sales" &&
      label(proof.primary.tax) === "Income taxes" &&
      proof.primary.tax.rowIndex > proof.primary.revenue.rowIndex,
    "Missing independent original primary statement"
  );
  const annual = p.kind === "annual";
  const primary = calendarSlots(proof.primary.headerRows, proof.primary.revenue, annual, true);
  const tax = calendarSlots(proof.primary.headerRows, proof.primary.tax, annual, true);
  const columns = proof.rows.map((r) => calendarSlots(proof.headerRows, r, annual));
  const selected: ServiceRevenueCell[] = [];
  const totalDimensions = columns[5][0].cell.fact!.dimensions;
  demand(
    sameDimensions(totalDimensions, {}) || sameDimensions(totalDimensions, operating),
    "Unreviewed original consolidated scope"
  );
  for (const [i, column] of columns[5].entries()) {
    const s = column.startDate + "|" + column.endDate;
    const original = columns.map((r) => r[i]);
    demand(
      original.every((c) => c && c.startDate + "|" + c.endDate === s) &&
        primary[i]?.startDate + "|" + primary[i]?.endDate === s &&
        tax[i]?.startDate + "|" + tax[i]?.endDate === s &&
        primary.length === columns[5].length &&
        tax.length === primary.length,
      "Original primary and hierarchy columns differ"
    );
    const facts = original.map((r) => r.cell.fact!);
    demand(
      facts.every(
        (f, j) =>
          f.tag === tag &&
          f.value >= 0 &&
          sameDimensions(f.dimensions, j === 5 ? totalDimensions : classifications[j].dimensions!)
      ) &&
        primary[i].cell.fact!.tag === tag &&
        !Object.keys(primary[i].cell.fact!.dimensions).length &&
        tax[i].cell.fact!.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
        !Object.keys(tax[i].cell.fact!.dimensions).length,
      "Changed original business meaning or primary scope"
    );
    const exact = original.map((r) => originalExactMillionDollars(r.cell));
    demand(
      exact[0] + exact[1] === exact[2] &&
        exact[2] + exact[3] + exact[4] === exact[5] &&
        exact[5] === originalExactMillionDollars(primary[i].cell),
      "Original hierarchy or independent consolidated total does not reconcile"
    );
    if (column.startDate === p.startDate && column.endDate === p.endDate) {
      const epsilon = Math.max(0.000001, Number(exact[5]) * Number.EPSILON);
      demand(
        Math.abs(primary[i].cell.fact!.value - p.metrics.revenue!) <= epsilon &&
          (p.metrics.incomeTax === undefined || tax[i].cell.fact!.value === p.metrics.incomeTax),
        "Original primary values differ from retained financial facts"
      );
      selected.push(...[0, 1, 3, 4].map((j) => original[j].cell));
    }
  }
  demand(selected.length === 4, "Missing selected original business column");
  const selectedRows = [0, 1, 3, 4];
  return selected.map((cell, i) => {
    const row = proof.rows[selectedRows[i]],
      name = label(row)!;
    return {
      id: `reported-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
      label: name,
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
        tableLabel: name,
        rowLabel: name,
        rowIndex: row.rowIndex,
        columnIndex: cell.columnIndex
      }
    };
  });
}

export function churchDwightRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.churchDwightRevenue;
    demand(
      s?.method === "reviewed-church-dwight-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.tableIndex === proof.tableIndex &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.revenueDecimals ===
          proof.rows
            .at(-1)!
            .cells.find((c) => c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate)
            ?.fact?.decimals &&
        s.totalLabel === "Total Consolidated Net Sales" &&
        !s.axis &&
        !s.qualifiers &&
        !s.standaloneRevenue &&
        !s.ametekRevenue &&
        !s.albemarleRevenue &&
        !s.productPortfolios &&
        !s.serviceRevenueRows &&
        !s.externalCustomerColumns &&
        !s.originalRevenueRows &&
        !s.omittedSubtotals.length &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === churchDwightRevenueBasis,
      "Invalid original Church & Dwight proof envelope"
    );
    demand(
      canonical(p.segments) === canonical(churchDwightRevenueSegments(p, proof)),
      "Original businesses were altered"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Church & Dwight proof";
  }
}
