import type { ServiceRevenueRowsProof } from "./types";
import type { PeriodV2 } from "./v2-types";
import type { DardenSourceFocus } from "./darden-types";
import { sameDimensions } from "./business-rules";
import { originalReviewedMillionDollarRows } from "./original-revenue-rows";
export type DardenBusinessProfile = {
  id: string;
  rows: { label: string; tag: string; dimensions: Record<string, string> }[];
};
export class DardenSourceProofError extends Error {}
export function demandDardenSource(c: unknown, message: string): asserts c {
  if (!c) throw new DardenSourceProofError(message);
}
const demand: typeof demandDardenSource = demandDardenSource;
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const integer = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;
const inside = (
  a: { columnIndex: number; span: number },
  b: { columnIndex: number; span: number }
) => a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
export const canonicalDardenSource = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const monthNames = [
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
const literalDate = (s: string) => {
  const m = s.match(/^(\w+) (\d{1,2}), (20\d{2})$/);
  if (!m) return;
  const month = monthNames.indexOf(m[1]),
    d = `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return date(d) ? d : undefined;
};
const add = (s: string, days: number) =>
  new Date(Date.parse(s) + days * 86400000).toISOString().slice(0, 10);
const lastSunday = (year: number) => {
  const d = new Date(Date.UTC(year, 4, 31));
  return add(d.toISOString().slice(0, 10), -d.getUTCDay());
};
/** Date inference is not publication evidence: this exact 52/53-week source
 * calendar must be corroborated by the original focus and every printed date. */
export function dardenFiscalScope(start: string, end: string) {
  demand(date(start) && date(end), "Invalid original revenue dates");
  const y = Number(end.slice(0, 4)),
    month = Number(end.slice(5, 7));
  demand([2, 5, 8, 11].includes(month), "Unreviewed original fiscal month");
  const year = [2, 5].includes(month) ? y : y + 1,
    base = add(lastSunday(year - 1), 1),
    quarter = month === 8 ? 1 : month === 11 ? 2 : month === 2 ? 3 : undefined;
  if (month === 5) {
    demand(start === base && end === lastSunday(year), "Original annual calendar changed");
    return { year, period: "FY", kind: "annual", start, end };
  }
  demand(
    end === add(base, quarter! * 91 - 1),
    "Original quarter end differs from reviewed 13-week calendar"
  );
  if (start === add(base, (quarter! - 1) * 91))
    return { year, period: `Q${quarter}`, kind: "quarterly", start, end };
  demand(quarter! > 1 && start === base, "Original cumulative scope changed");
  return {
    year,
    period: `Q${quarter}`,
    kind: quarter === 2 ? "six-months" : "nine-months",
    start,
    end
  };
}
export function validateDardenSourceFocus(p: PeriodV2, proof: DardenSourceFocus) {
  const u = new URL(p.sourceUrl);
  demand(
    p.accession &&
      /^\d{10}-\d{2}-\d{6}$/.test(p.accession) &&
      u.origin === "https://www.sec.gov" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.startsWith("/Archives/edgar/data/940944/" + p.accession.replaceAll("-", "") + "/"),
    "Changed original Darden issuer or accession"
  );
  demand(
    date(proof.reportDate) &&
      date(p.filedAt) &&
      proof.reportDate <= p.filedAt &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.fx,
    "Unreviewed original Darden source scope"
  );
  demand(
    Number.isInteger(proof.originalFiscalYear) &&
      proof.originalFiscalYear >= 2019 &&
      proof.originalFiscalYear <= 2100 &&
      ["FY", "Q1", "Q2", "Q3"].includes(proof.originalFiscalPeriod),
    "Unreviewed original Darden focus"
  );
  const currentEnd =
    proof.originalFiscalPeriod === "FY"
      ? lastSunday(proof.originalFiscalYear)
      : add(
          add(lastSunday(proof.originalFiscalYear - 1), 1),
          Number(proof.originalFiscalPeriod[1]) * 91 - 1
        );
  demand(
    currentEnd === proof.reportDate &&
      proof.form === (proof.originalFiscalPeriod === "FY" ? "10-K" : "10-Q"),
    "Original source focus conflicts with report date"
  );
  demand(
    typeof proof.fiscalCalendar === "string" &&
      proof.fiscalCalendar.length <= 16000 &&
      /52\/53[ -]week fiscal year(?:,)?(?: which)?(?: year)? (?:ending|which ends|which ends on|ending on|ends on) (?:on )?the last Sunday in May/i.test(
        proof.fiscalCalendar
      ),
    "Missing original last-Sunday fiscal-calendar evidence"
  );
  const selected = dardenFiscalScope(p.startDate, p.endDate);
  demand(
    selected.kind === p.kind &&
      selected.year === p.fiscalYear &&
      p.id ===
        (p.kind === "annual" ? `FY${selected.year}` : `${selected.year}-${selected.period}`) &&
      (p.kind === "annual"
        ? p.fiscalQuarter === undefined
        : p.fiscalQuarter === Number(selected.period[1])) &&
      selected.year <= proof.originalFiscalYear &&
      proof.originalFiscalYear - selected.year <= 2,
    "Selected period differs from original fiscal scope"
  );
  demand(
    proof.units.length >= 1 &&
      proof.units.length <= 100 &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Changed original units"
  );
  return selected;
}
export function originalDardenPrimaryColumns(
  proof: DardenSourceFocus & { primary: ServiceRevenueRowsProof["primary"] }
) {
  const p = proof.primary;
  demand(
    integer(p.tableIndex) &&
      /^.*CONSOLIDATED STATEMENTS OF (?:EARNINGS|INCOME).*$/i.test(p.title) &&
      p.title.length <= 2000,
    "Missing independent original primary statement"
  );
  const rows = [...p.headerRows, p.revenue, p.tax];
  originalReviewedMillionDollarRows(rows, proof.units, "0000940944");
  demand(
    p.headerRows.length >= 2 &&
      p.headerRows.length <= 8 &&
      p.headerRows.every(
        (r, i) =>
          r.rowIndex === i && r.rowIndex < p.revenue.rowIndex && r.cells.every((c) => !c.fact)
      ) &&
      p.headerRows.at(-1)!.rowIndex + 1 === p.revenue.rowIndex &&
      p.tax.rowIndex > p.revenue.rowIndex,
    "Changed original primary header topology"
  );
  demand(
    p.revenue.cells[0]?.label === "Sales" &&
      /^(?:Income tax expense|Income tax expense \(benefit\)|Income tax benefit|Income tax \(benefit\) expense)$/.test(
        p.tax.cells[0]?.label ?? ""
      ),
    "Changed original primary revenue/tax meaning"
  );
  const allHeaders = p.headerRows.flatMap((r) =>
      r.cells.map((c) => ({ ...c, rowIndex: r.rowIndex }))
    ),
    amounts = p.revenue.cells.filter((c) => c.fact),
    taxes = p.tax.cells.filter((c) => c.fact),
    out = [];
  demand(
    [p.revenue, p.tax].every(
      (r) =>
        !r.cells[0]?.fact && r.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label))
    ),
    "Unaccounted original primary monetary cell"
  );
  demand(
    amounts.length ===
      (proof.originalFiscalPeriod === "FY" ? 3 : proof.originalFiscalPeriod === "Q1" ? 2 : 4) &&
      taxes.length === amounts.length,
    "Incomplete original primary periods"
  );
  for (const c of amounts) {
    const f = c.fact!;
    demand(
      f.tag === "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" &&
        f.value > 0 &&
        sameDimensions(f.dimensions, {}),
      "Invalid original primary revenue classification"
    );
    const s = dardenFiscalScope(f.startDate, f.endDate);
    const printed = allHeaders.filter((h) => literalDate(h.label) && inside(c, h));
    demand(
      printed.length === 1 && literalDate(printed[0].label) === f.endDate,
      "Original primary date column changed"
    );
    const bands = allHeaders.filter(
      (h) =>
        /^(?:Fiscal Year Ended|Three Months Ended|Six Months Ended|Nine Months Ended)$/.test(
          h.label
        ) &&
        h.rowIndex < printed[0].rowIndex &&
        inside(printed[0], h)
    );
    const soleShiftedQ1 =
      proof.originalFiscalPeriod === "Q1" &&
      [2024, 2025, 2026].includes(proof.originalFiscalYear) &&
      allHeaders.filter((h) => /Months Ended/.test(h.label)).length === 1 &&
      allHeaders.some(
        (h) =>
          h.rowIndex === 1 &&
          h.columnIndex === 9 &&
          h.span === 9 &&
          h.label === "Three Months Ended"
      ) &&
      allHeaders.filter((h) => literalDate(h.label)).length === 2 &&
      amounts.length === 2 &&
      printed[0].rowIndex === 2 &&
      printed[0].span === 3 &&
      [15, 21].includes(printed[0].columnIndex);
    demand(
      (bands.length === 1 || soleShiftedQ1) &&
        (bands[0]?.label ?? "Three Months Ended") ===
          (s.kind === "annual"
            ? "Fiscal Year Ended"
            : s.kind === "quarterly"
              ? "Three Months Ended"
              : s.kind === "six-months"
                ? "Six Months Ended"
                : "Nine Months Ended"),
      "Original primary duration header changed"
    );
    const tax = taxes.filter(
      (t) =>
        t.fact!.startDate === f.startDate && t.fact!.endDate === f.endDate && inside(t, printed[0])
    );
    demand(
      tax.length === 1 &&
        tax[0].fact!.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
        sameDimensions(tax[0].fact!.dimensions, {}),
      "Incomplete original independent tax column"
    );
    out.push({ scope: s, revenue: c, tax: tax[0], dateColumn: printed[0] });
  }
  const expected = [];
  for (const y of proof.originalFiscalPeriod === "FY"
    ? [proof.originalFiscalYear, proof.originalFiscalYear - 1, proof.originalFiscalYear - 2]
    : [proof.originalFiscalYear, proof.originalFiscalYear - 1]) {
    const base = add(lastSunday(y - 1), 1);
    if (proof.originalFiscalPeriod === "FY") expected.push(base + "|" + lastSunday(y));
    else {
      const q = Number(proof.originalFiscalPeriod[1]),
        end = add(base, q * 91 - 1);
      expected.push(add(base, (q - 1) * 91) + "|" + end);
      if (q > 1) expected.push(base + "|" + end);
    }
  }
  demand(
    canonicalDardenSource(out.map((p) => p.scope.start + "|" + p.scope.end).sort()) ===
      canonicalDardenSource(expected.sort()),
    "Original primary columns differ from current/comparative source focus"
  );
  return out;
}
