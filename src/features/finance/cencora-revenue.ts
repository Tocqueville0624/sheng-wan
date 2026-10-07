import type {
  CencoraBusinessProof,
  RevenueSegment,
  ServiceRevenueCell,
  ServiceRevenueRow
} from "./types";
import type { PeriodV2 } from "./v2-types";
import { cencoraBusinessProfiles } from "./cencora-business-profiles";
import { originalThousandDollarRows } from "./original-revenue-rows";

export class CencoraRevenueProofError extends Error {}
function demand(v: unknown, reason: string): asserts v {
  if (!v) throw new CencoraRevenueProofError(reason);
}
const cik = "0001140859";
const revenueTag = "us-gaap:Revenues";
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const index = (n: number) => Number.isInteger(n) && n >= 0 && n < 5000;
const monetary = (r: ServiceRevenueRow) => r.cells.filter((c) => c.fact);
const label = (r: ServiceRevenueRow) => r.cells[0]?.label ?? "";
const within = (a: ServiceRevenueCell, b: ServiceRevenueCell) =>
  a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
const scopeKey = (c: ServiceRevenueCell) => c.fact!.startDate + "|" + c.fact!.endDate;
const day = (year: number, month: number, date: number) =>
  new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);

/** September fiscal years and the original calendar-year labels are distinct.
 * Original Q1 captions are physically shifted left of the comparative year
 * column in several filings; only the observed sole December Q1 band is shared. */
function calendar(headers: ServiceRevenueRow[], c: ServiceRevenueCell) {
  const all = headers.flatMap((r) => r.cells.map((h) => ({ ...h, row: r.rowIndex })));
  const years = all.filter((h) => /^20\d{2}$/.test(h.label) && within(c, h));
  demand(years.length === 1, "Missing or ambiguous original Cencora year column");
  const year = Number(years[0].label);
  const temporal = all.filter((h) =>
    /^(?:Fiscal Year|Three months|Six months|Nine months) ended (?:September|December|March|June) (?:30|31),$/i.test(
      h.label
    )
  );
  let bands = temporal.filter((h) => h.row < years[0].row && within(c, h));
  if (
    !bands.length &&
    temporal.length === 1 &&
    /^Three months ended December 31,$/i.test(temporal[0].label) &&
    temporal[0].row < years[0].row &&
    all.filter((h) => /^20\d{2}$/.test(h.label)).length === 2
  )
    bands = temporal;
  demand(bands.length === 1, "Missing or ambiguous original Cencora duration band");
  const band = bands[0].label;
  let start: string, end: string, fiscalYear: number, fiscalQuarter: number | undefined;
  let kind: "annual" | "quarterly" | "year-to-date";
  if (/^Fiscal Year Ended September 30,$/i.test(band)) {
    start = day(year - 1, 10, 1);
    end = day(year, 9, 30);
    fiscalYear = year;
    kind = "annual";
  } else {
    const match = band.match(/^(Three|Six|Nine) months ended (December|March|June) (30|31),$/i)!;
    demand(match, "Unreviewed original Cencora temporal caption");
    const month = ({ December: 12, March: 3, June: 6 } as Record<string, number>)[
      match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()
    ];
    const count = ({ three: 3, six: 6, nine: 9 } as Record<string, number>)[match[1].toLowerCase()];
    fiscalQuarter = month === 12 ? 1 : month === 3 ? 2 : 3;
    fiscalYear = month === 12 ? year + 1 : year;
    demand(
      Number(match[3]) === (month === 6 ? 30 : 31) && (count === 3 || count === fiscalQuarter * 3),
      "Original Cencora quarter caption differs"
    );
    start = count === 3 ? day(year, month - 2, 1) : day(fiscalYear - 1, 10, 1);
    end = day(year, month, Number(match[3]));
    kind = count === 3 ? "quarterly" : "year-to-date";
  }
  demand(
    c.fact!.startDate === start && c.fact!.endDate === end,
    "Original Cencora context dates contradict the visible fiscal column"
  );
  return { start, end, fiscalYear, fiscalQuarter, kind };
}

export const cencoraRevenueBasis =
  "Original reported Cencora business/product revenues include internal sales. Disjoint product leaves are counted once; reported parent subtotals only corroborate them. The original negative intersegment elimination is deducted separately, never allocated to a business or inferred from a residual. Every original comparative/YTD column agrees with its independently reported primary revenue.";

/** Replay all original columns before selecting one retained period. A malformed
 * annual fact with a quarterly context invalidates the entire source hierarchy;
 * no declaration date is rewritten to fit a printed column. */
export function cencoraBusinessPartition(p: PeriodV2, proof: CencoraBusinessProof) {
  const url = new URL(p.sourceUrl),
    source = p.metricSources.revenue;
  demand(
    proof.ruleId === "cor-original-revenue-hierarchy-v1" &&
      p.accession &&
      /^\d{10}-\d{2}-\d{6}$/.test(p.accession) &&
      url.origin === "https://www.sec.gov" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(
        "/Archives/edgar/data/1140859/" + p.accession.replaceAll("-", "") + "/"
      ),
    "Original Cencora issuer/accession mismatch"
  );
  demand(
    p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.fx &&
      validDate(p.startDate) &&
      validDate(p.endDate) &&
      validDate(proof.reportDate) &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt &&
      source?.method === "reported" &&
      source.tag === revenueTag &&
      source.sourceUrl === p.sourceUrl &&
      source.accession === p.accession &&
      source.filedAt === p.filedAt,
    "Changed original Cencora primary revenue/source scope"
  );
  demand(
    Number.isInteger(proof.originalFiscalYear) &&
      proof.originalFiscalYear >= 2019 &&
      proof.originalFiscalYear >= p.fiscalYear &&
      proof.originalFiscalYear - p.fiscalYear <= 2 &&
      (p.kind === "annual" ? /^10-K(?:\/A)?$/ : /^10-Q(?:\/A)?$/).test(proof.form) &&
      (p.kind === "annual"
        ? proof.originalFiscalPeriod === "FY"
        : /^Q[1-3]$/.test(proof.originalFiscalPeriod)),
    "Unreviewed original Cencora fiscal focus"
  );
  const originalQuarter = Number(proof.originalFiscalPeriod.slice(1));
  const reportEnd =
    p.kind === "annual"
      ? day(proof.originalFiscalYear, 9, 30)
      : originalQuarter === 1
        ? day(proof.originalFiscalYear - 1, 12, 31)
        : originalQuarter === 2
          ? day(proof.originalFiscalYear, 3, 31)
          : day(proof.originalFiscalYear, 6, 30);
  demand(
    proof.reportDate === reportEnd &&
      index(proof.tableIndex) &&
      index(proof.primary.tableIndex) &&
      proof.tableIndex !== proof.primary.tableIndex &&
      proof.units.length > 0 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length &&
      typeof proof.caption === "string" &&
      proof.caption.length <= 12000,
    "Original Cencora report date/table identity differs"
  );
  demand(
    proof.rows.length > 0 &&
      proof.rows.length <= 200 &&
      proof.rows.every((r, i) => r.rowIndex === i),
    "Incomplete original Cencora physical rows"
  );
  originalThousandDollarRows(proof.rows, proof.units, cik);
  originalThousandDollarRows(
    [...proof.primary.headerRows, proof.primary.revenue, proof.primary.tax],
    proof.units,
    cik
  );
  demand(
    /consolidated statements of operations/i.test(proof.primary.title) &&
      /^Revenue(?:s)?$/i.test(label(proof.primary.revenue)) &&
      proof.primary.tax.rowIndex > proof.primary.revenue.rowIndex &&
      proof.primary.headerRows.every((r, i) => r.rowIndex === i) &&
      proof.primary.revenue.rowIndex === proof.primary.headerRows.length &&
      proof.primary.headerRows.some((r) =>
        r.cells.some((c) => /^\(in thousands, except per share data\)$/i.test(c.label))
      ),
    "Missing complete independent original Cencora primary headers"
  );
  const rows = proof.rows.filter((r) => monetary(r).length);
  demand(
    rows.length >= 6 && rows.every((r) => label(r)),
    "Incomplete original Cencora business rows"
  );
  const shape = rows.map((r) => {
    const cells = monetary(r);
    demand(
      cells.every(
        (c) =>
          c.fact!.tag === revenueTag &&
          canonical(c.fact!.dimensions) === canonical(cells[0].fact!.dimensions)
      ),
      "Original Cencora revenue classification changes across columns"
    );
    return { label: label(r), tag: cells[0].fact!.tag, dimensions: cells[0].fact!.dimensions };
  });
  const matches = cencoraBusinessProfiles.filter((s) => canonical(s.rows) === canonical(shape));
  demand(matches.length === 1, "Unreviewed original Cencora hierarchy classification");
  const profile = matches[0],
    headers = proof.rows.filter((r) => r.rowIndex < rows[0].rowIndex);
  demand(
    headers.some((r) => r.cells.some((c) => /^\(in thousands\)$/i.test(c.label))),
    "Missing original Cencora business dollar scale"
  );
  const lastYear = proof.rows.filter((r) => r.cells.some((c) => /^20\d{2}$/.test(c.label))).at(-1);
  demand(lastYear, "Original Cencora year headings missing");
  const sections = proof.rows
    .filter((r) => r.rowIndex > lastYear.rowIndex && !monetary(r).length)
    .map(label)
    .filter(Boolean);
  demand(
    profile.sections.some((s) => canonical(s) === canonical(sections)),
    "Original Cencora section captions changed"
  );
  const primary = monetary(proof.primary.revenue),
    taxes = monetary(proof.primary.tax);
  const totals = monetary(rows.at(-1)!);
  demand(
    totals.length >= 2 &&
      totals.length <= 4 &&
      primary.length === totals.length &&
      taxes.length === primary.length,
    "Incomplete original Cencora comparative/YTD columns"
  );
  const primaryScopes = new Set<string>();
  for (const c of primary) {
    const f = c.fact!,
      scope = calendar(proof.primary.headerRows, c),
      key = scopeKey(c);
    const tax = taxes.filter((t) => scopeKey(t) === key);
    demand(
      !primaryScopes.has(key) &&
        tax.length === 1 &&
        !Object.keys(f.dimensions).length &&
        f.tag === revenueTag &&
        tax[0].fact!.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
        !Object.keys(tax[0].fact!.dimensions).length &&
        canonical(calendar(proof.primary.headerRows, tax[0])) === canonical(scope),
      "Original Cencora primary/tax column scope differs"
    );
    primaryScopes.add(key);
  }
  let selected: ServiceRevenueCell[] | undefined;
  const totalScopes = new Set<string>();
  for (const total of totals) {
    const key = scopeKey(total),
      scope = calendar(headers, total);
    demand(!totalScopes.has(key), "Duplicated original Cencora closing column");
    totalScopes.add(key);
    const column = rows.map((r) => {
      const cells = monetary(r).filter((c) => scopeKey(c) === key);
      demand(
        cells.length === 1 && canonical(calendar(headers, cells[0])) === canonical(scope),
        "Incomplete or conflicting original Cencora business column"
      );
      return cells[0];
    });
    for (const group of profile.groups)
      demand(
        group.children.reduce((n, i) => n + BigInt(column[i].fact!.value), 0n) ===
          BigInt(column[group.parent].fact!.value),
        "Original Cencora hierarchy subtotal disagrees"
      );
    demand(
      profile.branches.every((i) => column[i].fact!.value >= 0) &&
        column[profile.elimination].fact!.value <= 0 &&
        profile.branches.reduce((n, i) => n + BigInt(column[i].fact!.value), 0n) +
          BigInt(column[profile.elimination].fact!.value) ===
          BigInt(total.fact!.value),
      "Original Cencora product leaves and reported elimination disagree"
    );
    const reported = primary.filter((c) => scopeKey(c) === key);
    demand(
      reported.length === 1 && reported[0].fact!.value === total.fact!.value,
      "Original Cencora business and primary revenue disagree"
    );
    if (key === p.startDate + "|" + p.endDate) {
      const tax = taxes.find((c) => scopeKey(c) === key)!;
      demand(
        !selected &&
          scope.kind === p.kind &&
          scope.fiscalYear === p.fiscalYear &&
          (p.kind !== "quarterly" || scope.fiscalQuarter === p.fiscalQuarter) &&
          reported[0].fact!.value === p.metrics.revenue &&
          tax.fact!.value === p.metrics.incomeTax,
        "Original Cencora selected facts differ from the retained financial period"
      );
      selected = column;
    }
  }
  demand(
    rows.every((r) => monetary(r).length === totals.length) && selected,
    "Unaccounted original Cencora monetary columns or missing selected period"
  );
  const branch = (i: number): RevenueSegment => {
    const c = selected![i],
      f = c.fact!,
      name = label(rows[i]);
    return {
      id:
        i === profile.elimination
          ? "reported-intersegment-eliminations"
          : ("reported-" + cik + "-" + name).replace(/[^a-zA-Z0-9_-]/g, "-"),
      label: name,
      revenue: f.value,
      revenueSource: {
        sourceUrl: p.sourceUrl,
        accession: p.accession!,
        filedAt: p.filedAt,
        startDate: p.startDate,
        endDate: p.endDate,
        currency: "USD",
        tag: f.tag,
        dimensions: f.dimensions,
        value: f.value,
        decimals: f.decimals,
        tableLabel: name,
        rowLabel: name,
        rowIndex: rows[i].rowIndex,
        columnIndex: c.columnIndex
      }
    };
  };
  return {
    segments: profile.branches.map(branch),
    adjustments: [branch(profile.elimination)],
    totalLabel: label(rows.at(-1)!),
    totalDecimals: selected.at(-1)!.fact!.decimals
  };
}

export function cencoraRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.cencoraRevenue;
    demand(
      s?.method === "reviewed-cencora-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.tableIndex === proof.tableIndex &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === revenueTag &&
        !s.axis &&
        !s.qualifiers &&
        !s.standaloneRevenue &&
        !s.ametekRevenue &&
        !s.churchDwightRevenue &&
        !s.originalBusinessHierarchy &&
        !s.albemarleRevenue &&
        !s.productPortfolios &&
        !s.serviceRevenueRows &&
        !s.externalCustomerColumns &&
        !s.originalRevenueRows &&
        !s.omittedSubtotals.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === cencoraRevenueBasis,
      "Invalid original Cencora proof envelope"
    );
    const parsed = cencoraBusinessPartition(p, proof);
    demand(
      s.totalLabel === parsed.totalLabel &&
        s.revenueDecimals === parsed.totalDecimals &&
        canonical(p.segments) === canonical(parsed.segments) &&
        canonical(p.revenueAdjustments) === canonical(parsed.adjustments),
      "Original Cencora product amounts/elimination or source precision were altered"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Cencora source hierarchy";
  }
}
