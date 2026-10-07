import { sameDimensions, sourceLabel, type BusinessRule } from "./business-rules";
import { originalMillionDollarRows, originalThousandDollarRows } from "./original-revenue-rows";
import type { ServiceRevenueRow } from "./types";
import type { PeriodV2 } from "./v2-types";

type Proof = NonNullable<NonNullable<PeriodV2["businessBreakdownSource"]>["originalRevenueRows"]>;
const demand = (value: unknown, reason = "Incomplete original business revenue section") => {
  if (!value) throw Error(reason);
};
const facts = (row: ServiceRevenueRow) => row.cells.filter((c) => c.fact);
const label = (row: ServiceRevenueRow) => sourceLabel(row.cells[0]?.label ?? "");
const covers = (c: ServiceRevenueRow["cells"][number], column: number) =>
  c.columnIndex <= column && c.columnIndex + c.span > column;
const overlaps = (a: ServiceRevenueRow["cells"][number], b: ServiceRevenueRow["cells"][number]) =>
  a.columnIndex < b.columnIndex + b.span && b.columnIndex < a.columnIndex + a.span;

/** Replay every physical row and every original comparative/YTD column. Unknown
 * branches, missing declarations, netting and untagged monetary cells cannot be
 * hidden by a subset of known amounts which happens to sum to the total. */
export function originalBusinessRowsValid(period: PeriodV2, rule: BusinessRule, proof?: Proof) {
  return originalBusinessRowsProblem(period, rule, proof) === undefined;
}

export function originalBusinessRowsProblem(period: PeriodV2, rule: BusinessRule, proof?: Proof) {
  if (!rule.originalRows) return proof ? "Unexpected original business rows" : undefined;
  try {
    demand(proof && rule.layout === "rows" && !period.revenueAdjustments?.length);
    const p = proof!;
    const url = new URL(period.sourceUrl);
    demand(
      url.origin === "https://www.sec.gov" &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith(
          `/Archives/edgar/data/${Number(rule.cik)}/${period.accession?.replaceAll("-", "")}/`
        ) &&
        period.reportingCurrency === "USD" &&
        period.displayCurrency === "USD" &&
        period.metricSources.revenue?.method === "reported" &&
        period.segmentBasis === rule.basis
    );
    const validate =
      rule.originalRows.scale === 3 ? originalThousandDollarRows : originalMillionDollarRows;
    const complete = (rows: ServiceRevenueRow[]) => {
      demand(rows.length >= 3 && rows.length <= 40 && rows.every((r, i) => r.rowIndex === i));
      validate(rows, p.units, rule.cik);
    };
    complete(p.rows);
    const money = p.rows.filter((r) => facts(r).length);
    demand(money.length === rule.branches.length + 1);
    const total = money.at(-1)!;
    demand(total === p.rows.at(-1) && label(total) === rule.originalRows.closingLabel);
    const headers = p.rows.slice(0, money[0].rowIndex);
    demand(headers.length > 0);
    const month =
      "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
    const dateHeading = `${month} \\d{1,2},?(?: \\d{4})?`;
    const annualHeading =
      rule.originalRows.annualHeading === "for-years-ended"
        ? `|For the Years Ended ${dateHeading},?`
        : "";
    const header = new RegExp(
      `^(?:(?:(?:Three|Six|Nine) Months|Year) Ended(?: ${dateHeading})?,?|${dateHeading}|\\d{4}|\\(in (?:thousands|millions)(?:,[^)]*)?\\)|Revenues:${annualHeading})$`,
      "i"
    );
    demand(
      headers.every((r) => r.cells.every((c) => !c.label || header.test(c.label))),
      "Unknown row before the original revenue section"
    );
    demand(
      new RegExp(rule.originalRows.scale === 3 ? "in thousands" : "in millions", "i").test(
        headers.flatMap((r) => r.cells.map((c) => c.label)).join(" ")
      )
    );
    const headings = (column: number) =>
      headers.flatMap((r) => r.cells.filter((c) => covers(c, column)).map((c) => c.label));
    const allHeadings = headers.flatMap((r) => r.cells.map((c) => c.label)).join(" ");
    const monthPattern =
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?/g;
    const allMonthDays = [...allHeadings.matchAll(monthPattern)];
    const monthDays = new Set(allMonthDays.map((m) => `${m[1]} ${m[2]}`));
    const durationPattern = /Three Months|Six Months|Nine Months|Years? Ended/gi;
    const durations = new Set(allHeadings.match(durationPattern));
    const checkHeading = (
      column: number,
      f: NonNullable<ServiceRevenueRow["cells"][number]["fact"]>
    ) => {
      const scoped = headings(column).join(" ");
      demand(
        new RegExp(`\\b${f.endDate.slice(0, 4)}\\b`).test(scoped),
        "Original column year differs from its fact"
      );
      const monthDay =
        [...scoped.matchAll(monthPattern)][0] ??
        (monthDays.size === 1 ? allMonthDays[0] : undefined);
      demand(monthDay, "Missing original column date heading");
      const date = new Date(`${monthDay![1]} ${monthDay![2]}, ${f.endDate.slice(0, 4)}`)
        .toISOString()
        .slice(0, 10);
      demand(date === f.endDate, "Original column date differs from its fact");
      const days = (Date.parse(f.endDate) - Date.parse(f.startDate)) / 86400000 + 1;
      const text =
        scoped.match(durationPattern)?.join(" ") ?? (durations.size === 1 ? [...durations][0] : "");
      const duration = /Three Months/i.test(text)
        ? 3
        : /Six Months/i.test(text)
          ? 6
          : /Nine Months/i.test(text)
            ? 9
            : /Years? Ended/i.test(text)
              ? 12
              : undefined;
      demand(
        duration && Math.abs(days - duration * 30.44) <= 10,
        `Original duration heading does not match ${f.startDate}/${f.endDate}: ${text}`
      );
    };
    for (const [index, branch] of rule.branches.entries()) {
      const row = money[index];
      demand(label(row) === branch.rowLabel);
      demand(facts(row).length === facts(total).length);
      for (const c of facts(row)) {
        const f = c.fact!;
        demand(
          f.tag === branch.tag && sameDimensions(f.dimensions, branch.dimensions) && f.value >= 0
        );
        checkHeading(c.columnIndex, f);
      }
    }
    // Untagged blanks and currency/punctuation cells remain physical blanks;
    // any added revenue label or numeric cell inside the section fails closed.
    for (const row of p.rows.slice(money[0].rowIndex)) {
      if (!facts(row).length) demand(row.cells.every((c) => !c.label));
      else demand(row.cells.slice(1).every((c) => c.fact || /^[\s$()—–-]*$/.test(c.label)));
    }
    const totals = facts(total);
    demand(totals.length >= 1 && totals.length <= 4);
    const scopes = new Set<string>();
    for (const c of totals) {
      const f = c.fact!;
      demand(f.tag === rule.totalTag && !Object.keys(f.dimensions).length && f.value > 0);
      checkHeading(c.columnIndex, f);
      const scope = `${f.startDate}|${f.endDate}`;
      demand(!scopes.has(scope), `Repeated original scope ${scope}`);
      scopes.add(scope);
      let sum = 0;
      for (const row of money.slice(0, -1)) {
        const aligned = facts(row).filter((v) => overlaps(v, c));
        demand(aligned.length === 1);
        const part = aligned[0].fact;
        demand(part && part.startDate === f.startDate && part.endDate === f.endDate);
        sum += part!.value;
      }
      demand(sum === f.value, `Original comparative revenue does not reconcile: ${scope}`);
    }
    const current = totals.filter(
      (c) => c.fact!.startDate === period.startDate && c.fact!.endDate === period.endDate
    );
    demand(current.length === 1 && current[0].fact!.value === period.metrics.revenue);
    demand(period.segments?.length === rule.branches.length);
    for (const [index, branch] of rule.branches.entries()) {
      const segment = period.segments![index],
        f = facts(money[index]).find((c) => overlaps(c, current[0]))!.fact!;
      demand(
        segment.label === branch.label &&
          segment.revenue === f.value &&
          !segment.grossProfitSource &&
          segment.grossProfit === undefined
      );
      demand(
        segment.revenueSource?.tag === f.tag &&
          segment.revenueSource.value === f.value &&
          segment.revenueSource.decimals === f.decimals &&
          sameDimensions(segment.revenueSource.dimensions, f.dimensions)
      );
    }
    demand(!!p.primaryRows === !!rule.separateTotal);
    if (p.primaryRows) {
      complete(p.primaryRows);
      const primary = p.primaryRows.filter((r) => facts(r).length);
      demand(
        primary.length === 1 &&
          primary[0] === p.primaryRows.at(-1) &&
          label(primary[0]) === rule.totalLabel
      );
      const matching = facts(primary[0]).filter(
        (c) => c.fact!.startDate === period.startDate && c.fact!.endDate === period.endDate
      );
      demand(
        matching.length === 1 &&
          matching[0].fact!.tag === rule.totalTag &&
          !Object.keys(matching[0].fact!.dimensions).length &&
          matching[0].fact!.value === period.metrics.revenue
      );
      demand(facts(primary[0]).length === totals.length);
      for (const c of facts(primary[0])) {
        const f = c.fact!;
        const sameScope = totals.filter(
          (t) => t.fact!.startDate === f.startDate && t.fact!.endDate === f.endDate
        );
        demand(
          f.tag === rule.totalTag &&
            !Object.keys(f.dimensions).length &&
            sameScope.length === 1 &&
            f.value === sameScope[0].fact!.value
        );
      }
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid original revenue section";
  }
}
