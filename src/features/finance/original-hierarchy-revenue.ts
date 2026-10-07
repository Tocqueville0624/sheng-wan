import type {
  OriginalBusinessHierarchyProof,
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
import {
  averyBusinessProfiles,
  averyMaterialProfiles,
  baxterBusinessProfiles,
  type OriginalHierarchyProfile
} from "./original-hierarchy-profiles";

export class OriginalHierarchyProofError extends Error {}
function demand(v: unknown, why: string): asserts v {
  if (!v) throw new OriginalHierarchyProofError(why);
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
const label = (r: ServiceRevenueRow) => r.cells[0]?.label ?? "";
const monetary = (r: ServiceRevenueRow) => r.cells.filter((c) => c.fact);
const within = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
const overlaps = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex < b.columnIndex + b.span && b.columnIndex < a.columnIndex + a.span;
const months = [
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
const geo = "srt:StatementGeographicalAxis";
const tags = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const geographicMembers = ["country:US", "us-gaap:NonUsMember"];
const day = (n: number) => new Date(n).toISOString().slice(0, 10);
function printedDate(s: string): string | undefined {
  const m = s.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})(?: \([12]\))?$/
  );
  if (!m) return;
  const result = `${m[3]}-${String(months.indexOf(m[1]) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return date(result) ? result : undefined;
}
function namedDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
}
function nearestSaturday(year: number, month = 12): string {
  const anchor = Date.UTC(year, month, 0),
    weekday = new Date(anchor).getUTCDay(),
    offset = ((6 - weekday + 10) % 7) - 3;
  return day(anchor + offset * 86400000);
}
function averyYearStart(year: number): string {
  return year >= 2026 ? `${year}-01-01` : day(Date.parse(nearestSaturday(year - 1)) + 86400000);
}
function averyCalendar(
  headers: ServiceRevenueRow[],
  c: ServiceRevenueCell,
  proof: OriginalBusinessHierarchyProof
): { year: number; kind: string } {
  const f = c.fact!;
  demand(date(f.startDate) && date(f.endDate), "Invalid original Avery Dennison date");
  const all = headers.flatMap((r) => r.cells.map((c) => ({ ...c, row: r.rowIndex }))),
    above = all.filter((h) => within(c, h));
  const years = above.filter((h) => /^20\d{2}(?: \(2\))?$/.test(h.label)),
    endDates = above.filter((h) => printedDate(h.label));
  demand(
    years.length === 1 || endDates.length === 1,
    "Missing original Avery Dennison column caption"
  );
  if (years.length === 1) {
    const year = Number(years[0].label.slice(0, 4)),
      end = year >= 2025 ? `${year}-12-31` : nearestSaturday(year);
    const start = averyYearStart(year),
      days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    demand(
      year >= 2021 &&
        f.startDate === start &&
        f.endDate === end &&
        (days === 364 || days === 371 || (year === 2025 && days === 368)),
      "Original Avery Dennison fiscal year differs from its caption"
    );
    demand(
      proof.fiscalCalendar.includes(namedDate(end)),
      "Original fiscal-year end is absent from the calendar note"
    );
    if (year === 2025)
      demand(
        proof.fiscalCalendar.includes("December 29, 2024") &&
          proof.fiscalCalendar.includes("December 31, 2025"),
        "Missing original fiscal-calendar transition"
      );
    if (year >= 2026)
      demand(
        /2026 and beyond/.test(proof.fiscalCalendar) &&
          /January 1/.test(proof.fiscalCalendar) &&
          /December 31/.test(proof.fiscalCalendar),
        "Missing original calendar-year policy"
      );
    return { year, kind: "annual" };
  }
  const h = endDates[0],
    end = printedDate(h.label)!,
    year = Number(end.slice(0, 4));
  let bands = above.filter((h) => /^(Three|Six|Nine) Months Ended$/.test(h.label));
  // The original Q1 reports place one shared Three Months Ended caption
  // left of the two dated columns. It governs both dates, with no YTD band.
  const shared = all.filter((h) => /^(Three|Six|Nine) Months Ended$/.test(h.label));
  if (!bands.length && shared.length === 1 && shared[0].label === "Three Months Ended")
    bands = shared;
  demand(bands.length === 1 && bands[0].row < h.row, "Misaligned original Avery Dennison duration");
  const count = ({ Three: 3, Six: 6, Nine: 9 } as Record<string, number>)[
      bands[0].label.split(" ")[0]
    ],
    month = Number(end.slice(5, 7));
  const quarter = year >= 2026 ? month / 3 : Math.round(month / 3);
  demand(
    Number.isInteger(quarter) && quarter >= 1 && quarter <= 3,
    "Unreviewed original Avery Dennison quarter"
  );
  const expectedEnd =
    year >= 2026 ? day(Date.UTC(year, quarter * 3, 0)) : nearestSaturday(year, quarter * 3);
  const start =
    count === 3
      ? quarter === 1
        ? averyYearStart(year)
        : day(
            Date.parse(
              year >= 2026
                ? day(Date.UTC(year, (quarter - 1) * 3, 0))
                : nearestSaturday(year, (quarter - 1) * 3)
            ) + 86400000
          )
      : averyYearStart(year);
  demand(
    end === expectedEnd &&
      f.endDate === end &&
      f.startDate === start &&
      (count === 3 || count === quarter * 3),
    "Original Avery Dennison dates contradict the fiscal caption"
  );
  return { year, kind: count === 3 ? "quarterly" : "year-to-date" };
}
function baxterCalendar(
  headers: ServiceRevenueRow[],
  c: ServiceRevenueCell
): { year: number; kind: string } {
  const f = c.fact!,
    above = headers.flatMap((r) => r.cells.filter((h) => within(c, h))),
    years = above.filter((h) => /^20\d{2}$/.test(h.label));
  demand(
    years.length === 1 && Number(f.endDate.slice(0, 4)) === Number(years[0].label),
    "Original Baxter fiscal year is missing or ambiguous"
  );
  const year = Number(years[0].label),
    bands = above.filter((h) =>
      /^(Three|Six|Nine) Months Ended (March|June|September) \d{1,2},$/i.test(h.label)
    );
  if (!bands.length) {
    demand(
      f.startDate === `${year}-01-01` && f.endDate === `${year}-12-31`,
      "Changed original Baxter annual dates"
    );
    return { year, kind: "annual" };
  }
  demand(bands.length === 1, "Overlapping original Baxter duration captions");
  const m = bands[0].label.match(
    /^(Three|Six|Nine) Months Ended (March|June|September) (\d{1,2}),$/i
  )!;
  const count = ({ three: 3, six: 6, nine: 9 } as Record<string, number>)[m[1].toLowerCase()],
    month = months.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1;
  const end = day(Date.UTC(year, month, 0)),
    start = `${year}-${String(count === 3 ? month - 2 : 1).padStart(2, "0")}-01`;
  demand(
    (count === 3 || count === month) &&
      f.startDate === start &&
      f.endDate === end &&
      Number(m[3]) === Number(end.slice(8)),
    "Original Baxter quarter/YTD scope changed"
  );
  return { year, kind: count === 3 ? "quarterly" : "year-to-date" };
}
function knownRows(
  rows: ServiceRevenueRow[],
  profiles: OriginalHierarchyProfile[],
  baxter: boolean
): { profile: OriginalHierarchyProfile; rows: ServiceRevenueRow[] } {
  const facts = rows.filter((r) => monetary(r).length),
    shape = facts.map((r) => {
      const f = monetary(r).find((c) => !baxter || !c.fact!.dimensions[geo])?.fact;
      demand(f, "Missing original worldwide business column");
      return { label: label(r), dimensions: f.dimensions };
    });
  const matches = profiles.filter((p) => canonical(p.rows) === canonical(shape));
  demand(matches.length === 1, "Unknown or incomplete original business hierarchy");
  const first = facts[0].rowIndex,
    last = facts.at(-1)!.rowIndex;
  demand(
    rows.every((r, i) => i === 0 || r.rowIndex === rows[i - 1].rowIndex + 1),
    "An original physical row was omitted"
  );
  demand(
    rows
      .filter((r) => r.rowIndex >= first && r.rowIndex <= last && !monetary(r).length)
      .every((r) =>
        r.cells.every(
          (c, i) => !c.label || (i === 0 && /^(Materials Group:|Solutions Group:)$/.test(c.label))
        )
      ),
    "Unreported monetary row or unknown original business heading"
  );
  return { profile: matches[0], rows: facts };
}
function columns(
  rows: ServiceRevenueRow[],
  profile: OriginalHierarchyProfile,
  headers: ServiceRevenueRow[],
  proof: OriginalBusinessHierarchyProof,
  baxter: boolean
): ServiceRevenueCell[][] {
  const closing = monetary(rows.at(-1)!);
  demand(closing.length >= 2 && closing.length <= 12, "Changed original comparative column count");
  const used = rows.map(() => new Set<number>()),
    result: ServiceRevenueCell[][] = [];
  for (const total of closing) {
    const cells = rows.map((r, i) => {
      const matches = monetary(r).filter((c) => overlaps(c, total));
      demand(matches.length === 1, "Original business cells are misaligned");
      const c = matches[0];
      demand(!used[i].has(c.columnIndex), "An original monetary column was reused");
      used[i].add(c.columnIndex);
      return c;
    });
    const region = total.fact!.dimensions[geo],
      scope = baxter ? baxterCalendar(headers, total) : averyCalendar(headers, total, proof);
    if (baxter) {
      demand(
        region === undefined || geographicMembers.includes(region),
        "Unknown original Baxter geographic scope"
      );
      const regionLabels = headers.flatMap((r) =>
        r.cells
          .filter((h) => within(total, h) && /^(U\.S\.|International|Total)$/.test(h.label))
          .map((h) => h.label)
      );
      demand(
        regionLabels.length === 1 &&
          regionLabels[0] ===
            (region === undefined ? "Total" : region === "country:US" ? "U.S." : "International"),
        "Original geographic heading does not match its declarations"
      );
    }
    cells.forEach((c, i) => {
      const f = c.fact!,
        dims = region
          ? { ...profile.rows[i].dimensions, [geo]: region }
          : profile.rows[i].dimensions;
      demand(
        f.tag === tags &&
          f.value >= 0 &&
          f.startDate === total.fact!.startDate &&
          f.endDate === total.fact!.endDate &&
          sameDimensions(f.dimensions, dims),
        "Original business meanings, signs or dates changed"
      );
      const actual = baxter ? baxterCalendar(headers, c) : averyCalendar(headers, c, proof);
      demand(canonical(actual) === canonical(scope), "Original row captions disagree");
    });
    profile.groups.forEach((g) =>
      demand(
        g.children.reduce((sum, i) => sum + originalExactMillionDollars(cells[i]), 0n) ===
          originalExactMillionDollars(cells[g.parent]),
        "Original parent/product subtotal does not reconcile"
      )
    );
    result.push(cells);
  }
  demand(
    rows.every((r, i) => used[i].size === monetary(r).length),
    "An original monetary declaration was omitted"
  );
  if (baxter) {
    for (const global of result.filter((c) => !c.at(-1)!.fact!.dimensions[geo])) {
      const country = result.filter(
        (c) =>
          c.at(-1)!.fact!.dimensions[geo] &&
          c.at(-1)!.fact!.startDate === global.at(-1)!.fact!.startDate &&
          c.at(-1)!.fact!.endDate === global.at(-1)!.fact!.endDate
      );
      demand(
        country.length === 2 &&
          new Set(country.map((c) => c.at(-1)!.fact!.dimensions[geo])).size === 2,
        "Incomplete original U.S./international corroboration"
      );
      global.forEach((c, i) =>
        demand(
          country.reduce((sum, cs) => sum + originalExactMillionDollars(cs[i]), 0n) ===
            originalExactMillionDollars(c),
          "Original worldwide and geographic columns disagree"
        )
      );
    }
  }
  return result;
}
function retainedAmount(c: ServiceRevenueCell, value: number | undefined): boolean {
  if (value === undefined) return true;
  const exact = Number(originalExactMillionDollars(c));
  return (
    c.fact!.value === value ||
    Math.abs(value - exact) <= Math.max(0.000001, Math.abs(exact) * Number.EPSILON)
  );
}
export function originalHierarchyBasis(proof: OriginalBusinessHierarchyProof): string {
  return proof.ruleId.startsWith("avy-")
    ? `Reported Avery Dennison business and product revenue. ${proof.materialProducts ? "Complete Materials Group product rows are shown where this filing reports them; " : "Materials Group retains its reported total; "}Apparel and Identification Solutions retain this filing’s product classifications. Geographic rows corroborate Materials Group and are not additional businesses. Parent subtotals are not counted twice. Fiscal dates and comparative classifications follow the original report; no missing product mix or business gross profit is estimated.`
    : "Reported Baxter product revenue within the original business hierarchy, including its reported corporate Other revenue. U.S. and international columns corroborate the worldwide totals and are not additional businesses. Parent subtotals are not counted twice. Continuing-operation and comparative segment classifications follow this filing; no corporate residual or business gross profit is estimated.";
}
export function originalHierarchySegments(
  p: PeriodV2,
  proof: OriginalBusinessHierarchyProof
): RevenueSegment[] {
  const baxter = proof.ruleId === "bax-original-business-hierarchy-v1",
    cik = baxter ? "0000010456" : "0000008818",
    revenue = p.metricSources.revenue;
  demand(
    baxter || proof.ruleId === "avy-original-business-hierarchy-v1",
    "Unknown original hierarchy rule"
  );
  const url = new URL(p.sourceUrl);
  demand(
    url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      p.accession &&
      /^\d{10}-\d{2}-\d{6}$/.test(p.accession) &&
      url.pathname.startsWith(
        `/Archives/edgar/data/${Number(cik)}/${p.accession.replaceAll("-", "")}/`
      ),
    "Invalid original source issuer/accession"
  );
  demand(
    p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.fx &&
      revenue?.method === "reported" &&
      revenue.tag === tags &&
      revenue.sourceUrl === p.sourceUrl &&
      revenue.accession === p.accession &&
      revenue.filedAt === p.filedAt &&
      date(p.startDate) &&
      date(p.endDate) &&
      date(proof.reportDate) &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt,
    "Changed original primary revenue/source scope"
  );
  demand(
    Number.isInteger(proof.originalFiscalYear) &&
      proof.originalFiscalYear >= 2023 &&
      proof.originalFiscalYear >= p.fiscalYear &&
      proof.originalFiscalYear - p.fiscalYear <= 2 &&
      (p.kind === "annual" ? /^10-K(?:\/A)?$/ : /^10-Q(?:\/A)?$/).test(proof.form) &&
      (p.kind === "annual"
        ? proof.originalFiscalPeriod === "FY"
        : /^Q[1-3]$/.test(proof.originalFiscalPeriod)),
    "Unreviewed original filing/fiscal scope"
  );
  const reportQuarter = Number(proof.originalFiscalPeriod.slice(1));
  const originalReportEnd =
    p.kind === "annual"
      ? !baxter && proof.originalFiscalYear <= 2024
        ? nearestSaturday(proof.originalFiscalYear)
        : `${proof.originalFiscalYear}-12-31`
      : !baxter && proof.originalFiscalYear <= 2025
        ? nearestSaturday(proof.originalFiscalYear, reportQuarter * 3)
        : day(Date.UTC(proof.originalFiscalYear, reportQuarter * 3, 0));
  demand(
    proof.reportDate === originalReportEnd,
    "Original fiscal focus contradicts the report end"
  );
  if (p.kind === "quarterly")
    demand(
      p.fiscalQuarter === Math.round(Number(p.endDate.slice(5, 7)) / 3),
      "Retained fiscal quarter contradicts its original caption"
    );
  demand(
    index(proof.tableIndex) &&
      index(proof.primary.tableIndex) &&
      proof.tableIndex !== proof.primary.tableIndex &&
      proof.units.length > 0 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length &&
      typeof proof.caption === "string" &&
      proof.caption.length <= 12000 &&
      typeof proof.fiscalCalendar === "string" &&
      proof.fiscalCalendar.length <= 12000,
    "Invalid original table or notes"
  );
  originalReviewedMillionDollarRows(proof.rows, proof.units, cik);
  originalReviewedMillionDollarRows(
    [...proof.primary.headerRows, proof.primary.revenue, proof.primary.tax],
    proof.units,
    cik
  );
  demand(
    /consolidated statements of (?:income|loss)/i.test(proof.primary.title) &&
      /Net sales/i.test(label(proof.primary.revenue)) &&
      proof.primary.tax.rowIndex > proof.primary.revenue.rowIndex,
    "Missing independent original primary income table"
  );
  const profiles = baxter ? baxterBusinessProfiles : averyBusinessProfiles,
    { profile, rows } = knownRows(proof.rows, profiles, baxter),
    headers = proof.rows.filter((r) => r.rowIndex < rows[0].rowIndex);
  demand(
    headers.some((r) => r.cells.some((c) => /^\(in millions\)$/i.test(c.label))),
    "Missing original business units caption"
  );
  const all = columns(rows, profile, headers, proof, baxter),
    globals = all.filter((c) => !c.at(-1)!.fact!.dimensions[geo]);
  const primary = monetary(proof.primary.revenue),
    tax = monetary(proof.primary.tax);
  demand(
    primary.length >= globals.length && primary.length <= 4 && tax.length === primary.length,
    "Incomplete original primary comparative/quarter/YTD columns"
  );
  const primaryScopes = new Set<string>();
  for (const reported of primary) {
    const f = reported.fact!,
      key = `${f.startDate}|${f.endDate}`;
    const matchingTaxes = tax.filter((t) => overlaps(t, reported));
    demand(
      !primaryScopes.has(key) && matchingTaxes.length === 1,
      "Original primary dates or tax columns are duplicated/misaligned"
    );
    primaryScopes.add(key);
    const t = matchingTaxes[0].fact!;
    demand(
      f.tag === tags &&
        !Object.keys(f.dimensions).length &&
        t.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
        !Object.keys(t.dimensions).length &&
        t.startDate === f.startDate &&
        t.endDate === f.endDate,
      "Original independent primary revenue/tax scope differs"
    );
    const revenueScope = baxter
      ? baxterCalendar(proof.primary.headerRows, reported)
      : averyCalendar(proof.primary.headerRows, reported, proof);
    const taxScope = baxter
      ? baxterCalendar(proof.primary.headerRows, matchingTaxes[0])
      : averyCalendar(proof.primary.headerRows, matchingTaxes[0], proof);
    demand(canonical(revenueScope) === canonical(taxScope), "Original primary tax caption differs");
  }
  const selected: ServiceRevenueCell[][] = [];
  for (const c of globals) {
    const total = c.at(-1)!,
      f = total.fact!,
      match = (cells: ServiceRevenueCell[]) =>
        cells.filter((x) => x.fact!.startDate === f.startDate && x.fact!.endDate === f.endDate),
      reported = match(primary),
      taxes = match(tax);
    demand(
      reported.length === 1 && taxes.length === 1,
      "Missing independent original same-period primary facts"
    );
    demand(
      reported[0].fact!.tag === tags &&
        !Object.keys(reported[0].fact!.dimensions).length &&
        taxes[0].fact!.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
        !Object.keys(taxes[0].fact!.dimensions).length &&
        originalExactMillionDollars(reported[0]) === originalExactMillionDollars(total),
      "Original business and independent primary revenue disagree"
    );
    const scope = baxter
      ? baxterCalendar(proof.primary.headerRows, reported[0])
      : averyCalendar(proof.primary.headerRows, reported[0], proof);
    if (f.startDate === p.startDate && f.endDate === p.endDate) {
      demand(
        scope.year === p.fiscalYear &&
          scope.kind === p.kind &&
          retainedAmount(reported[0], p.metrics.revenue) &&
          retainedAmount(taxes[0], p.metrics.incomeTax),
        "Selected original facts differ from the retained period"
      );
      selected.push(c);
    }
  }
  demand(selected.length === 1, "Missing or duplicate original selected period");
  let leaves = profile.branches.map((i) => ({ row: rows[i], cell: selected[0][i] }));
  if (proof.materialProducts) {
    demand(
      !baxter &&
        p.kind === "annual" &&
        index(proof.materialProducts.tableIndex) &&
        proof.materialProducts.tableIndex !== proof.tableIndex &&
        proof.materialProducts.tableIndex !== proof.primary.tableIndex,
      "Invalid original Materials product table"
    );
    originalReviewedMillionDollarRows(proof.materialProducts.rows, proof.units, cik);
    const products = knownRows(proof.materialProducts.rows, averyMaterialProfiles, false),
      heads = proof.materialProducts.rows.filter((r) => r.rowIndex < products.rows[0].rowIndex),
      productColumns = columns(products.rows, products.profile, heads, proof, false);
    for (const pc of productColumns) {
      const f = pc.at(-1)!.fact!,
        main = globals.filter(
          (c) => c.at(-1)!.fact!.startDate === f.startDate && c.at(-1)!.fact!.endDate === f.endDate
        );
      demand(
        main.length === 1,
        "Original Materials product scope is absent from the complete business table"
      );
      const parent = main[0][profile.branches[0]];
      demand(
        sameDimensions(parent.fact!.dimensions, f.dimensions) &&
          originalExactMillionDollars(parent) === originalExactMillionDollars(pc.at(-1)!),
        "Original Materials products disagree with their reported parent"
      );
    }
    const matching = productColumns.filter(
      (pc) => pc.at(-1)!.fact!.startDate === p.startDate && pc.at(-1)!.fact!.endDate === p.endDate
    );
    demand(matching.length === 1, "Selected original Materials product column missing");
    leaves = [
      ...products.profile.branches.map((i) => ({ row: products.rows[i], cell: matching[0][i] })),
      ...leaves.slice(1)
    ];
  }
  return leaves.map(({ row, cell }) => {
    const name = label(row)
      .replace(/ \([12]\)$| 1$/g, "")
      .replace(/^Total Materials Group$/, "Materials Group");
    return {
      id: `reported-${cik}-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
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
        tableLabel: label(row),
        rowLabel: label(row),
        rowIndex: row.rowIndex,
        columnIndex: cell.columnIndex
      }
    };
  });
}
export function originalHierarchyProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.originalBusinessHierarchy;
    demand(
      s?.method === "reviewed-original-business-hierarchy" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.tableIndex === proof.tableIndex &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        !s.axis &&
        !s.qualifiers &&
        !s.standaloneRevenue &&
        !s.ametekRevenue &&
        !s.churchDwightRevenue &&
        !s.albemarleRevenue &&
        !s.productPortfolios &&
        !s.serviceRevenueRows &&
        !s.externalCustomerColumns &&
        !s.originalRevenueRows &&
        !s.omittedSubtotals.length &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === originalHierarchyBasis(proof),
      "Invalid original hierarchy proof envelope"
    );
    const closing = proof.rows.filter((r) => monetary(r).length).at(-1)!;
    demand(
      s.totalLabel === label(closing) &&
        s.revenueDecimals ===
          monetary(closing).find(
            (c) =>
              c.fact!.startDate === p.startDate &&
              c.fact!.endDate === p.endDate &&
              !c.fact!.dimensions[geo]
          )?.fact!.decimals,
      "Original closing scope/precision changed"
    );
    demand(
      canonical(p.segments) === canonical(originalHierarchySegments(p, proof)),
      "Original reported product leaves were altered"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original hierarchy";
  }
}
