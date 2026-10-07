import type { ServiceRevenueCell, ServiceRevenueRow, RevenueSegment } from "./types";
import type { PeriodV2 } from "./v2-types";
import type { DardenRevenueProof } from "./darden-types";
import {
  originalReviewedMillionDollarRows,
  originalExactMillionDollars
} from "./original-revenue-rows";
import { originalCellEncoding, decodeOriginalRows } from "./original-cell-tuples";
import {
  validateDardenSourceFocus,
  originalDardenPrimaryColumns,
  dardenFiscalScope,
  canonicalDardenSource,
  demandDardenSource,
  type DardenBusinessProfile
} from "./darden-source";
import { dardenBusinessProfiles } from "./darden-business-profiles";
const demand: typeof demandDardenSource = demandDardenSource;
const integer = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;
const inside = (
  a: { columnIndex: number; span: number },
  b: { columnIndex: number; span: number }
) => a.columnIndex >= b.columnIndex && a.columnIndex + a.span <= b.columnIndex + b.span;
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
const literalDate = (s: string) => {
  const m = s.match(/^(\w+) (\d{1,2}), (20\d{2})$/);
  if (!m) return;
  const d = `${m[3]}-${String(months.indexOf(m[1])).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d
    ? d
    : undefined;
};
export const dardenRevenueBasis =
  "Reported Olive Garden, LongHorn Steakhouse, Fine Dining and Other Business revenues from the filing's complete original segment tables. All current, comparative and year-to-date revenue columns reconcile to independent primary sales and tax scopes. The explicitly reported Corporate zero is retained separately. Aggregate restaurant groups are not allocated to individual brands; no missing revenue or business gross profit is estimated.";
export function originalDardenRevenuePartition(p: PeriodV2, encoded: DardenRevenueProof) {
  demand(
    encoded.ruleId === "dri-original-complete-revenue-v1" &&
      encoded.encoding === originalCellEncoding,
    "Changed original Darden revenue encoding"
  );
  const proof = {
    ...encoded,
    tables: encoded.tables.map((t) => ({ ...t, regions: t.regions.map(decodeOriginalRows) })),
    primary: {
      ...encoded.primary,
      headerRows: decodeOriginalRows(encoded.primary.headerRows),
      revenue: decodeOriginalRows([encoded.primary.revenue])[0],
      tax: decodeOriginalRows([encoded.primary.tax])[0]
    }
  };
  const profiles = dardenBusinessProfiles;
  validateDardenSourceFocus(p, proof);
  const primary = originalDardenPrimaryColumns(proof);
  demand(
    Array.isArray(proof.tables) &&
      proof.tables.length >= 1 &&
      proof.tables.length <= 3 &&
      new Set(proof.tables.map((t) => t.tableIndex)).size === proof.tables.length,
    "Incomplete original business tables"
  );
  const used = new Set<string>(),
    selected: {
      tableIndex: number;
      row: ServiceRevenueRow;
      cells: ServiceRevenueCell[];
      headers: ServiceRevenueCell[];
      profile: DardenBusinessProfile;
    }[] = [];
  for (const table of proof.tables) {
    demand(
      integer(table.tableIndex) &&
        table.tableIndex !== proof.primary.tableIndex &&
        table.sourceSalesRows.length === table.regions.length &&
        table.regions.length >= 1 &&
        table.regions.length <= 2 &&
        new Set(table.sourceSalesRows).size === table.sourceSalesRows.length,
      "Changed original Sales-row inventory"
    );
    let previous = -1;
    for (const [i, rows] of table.regions.entries()) {
      demand(
        rows.length === 4 &&
          rows.every((r, i) => r.rowIndex === rows[0].rowIndex + i) &&
          rows[0].rowIndex > previous &&
          rows[3].rowIndex === table.sourceSalesRows[i] &&
          rows[3].cells[0]?.label === "Sales",
        "Missing or reordered original business region"
      );
      previous = rows[3].rowIndex;
      originalReviewedMillionDollarRows(rows, proof.units, "0000940944");
      demand(
        rows.slice(0, 3).every((r) => r.cells.every((c) => !c.fact)),
        "Unaccounted amount in original business headings"
      );
      const heading = rows[1],
        caption = rows[2].cells.filter((c) => c.label),
        headers = heading.cells.filter((c) => c.label && c.columnIndex > 0);
      demand(
        rows[0].cells.every((c) => !c.label) &&
          heading.cells[0].label === "(in millions)" &&
          headers.length === 6 &&
          caption.length === 1 &&
          caption[0].columnIndex === 0,
        "Changed complete original business headers"
      );
      const m = caption[0].label.match(
        /^(?:At |For the (three|six|nine) months ended )(\w+ \d{1,2}, 20\d{2})(?: and for the year ended)?$/
      );
      demand(m && literalDate(m[2]), "Unreviewed original business duration caption");
      const row = rows[3],
        money = row.cells.filter((c) => c.fact);
      demand(
        money.length === 6 &&
          !row.cells[0].fact &&
          row.cells.slice(1).every((c) => c.fact || /^(?:\$|[—–-])?$/.test(c.label)),
        "Incomplete or unaccounted original business revenue amounts"
      );
      const total = money[5].fact!,
        s = dardenFiscalScope(total.startDate, total.endDate);
      demand(
        total.endDate === literalDate(m![2]) &&
          caption[0].label ===
            (s.kind === "annual"
              ? `At ${m![2]} and for the year ended`
              : `For the ${s.kind === "quarterly" ? "three" : s.kind === "six-months" ? "six" : "nine"} months ended ${m![2]}`),
        "Original business caption conflicts with context"
      );
      const key = total.startDate + "|" + total.endDate;
      demand(!used.has(key), "Duplicate original business scope");
      used.add(key);
      const classification = money.map((c, i) => {
        const f = c.fact!;
        demand(
          inside(c, headers[i]) &&
            f.startDate === total.startDate &&
            f.endDate === total.endDate &&
            f.value >= 0,
          "Original business column geometry or scope changed"
        );
        const fillers = row.cells.filter((x) => inside(x, headers[i]));
        demand(
          fillers.filter((x) => x.fact).length === 1 &&
            fillers.every((x) => x.fact || /^(?:\$|[—–-])?$/.test(x.label)),
          "Unresolved original business money column"
        );
        return { label: headers[i].label, tag: f.tag, dimensions: f.dimensions };
      });
      const profile = profiles.filter(
        (x) => canonicalDardenSource(x.rows) === canonicalDardenSource(classification)
      );
      demand(profile.length === 1, "Changed original Darden business classification");
      demand(
        money[4].fact!.value === 0 &&
          money[4].fact!.declarations.every((d) => /^ixt:(?:zerodash|fixed-zero)$/.test(d.format)),
        "Corporate is not an explicitly reported zero"
      );
      demand(
        money.slice(0, 5).reduce((n, c) => n + originalExactMillionDollars(c), 0n) ===
          originalExactMillionDollars(money[5]),
        "Original complete businesses do not reconcile"
      );
      const anchor = primary.filter(
        (p) => p.scope.start === total.startDate && p.scope.end === total.endDate
      );
      demand(
        anchor.length === 1 &&
          originalExactMillionDollars(anchor[0].revenue) === originalExactMillionDollars(money[5]),
        "Business total differs from independent original primary"
      );
      if (total.startDate === p.startDate && total.endDate === p.endDate) {
        demand(
          total.value === p.metrics.revenue &&
            p.metricSources.revenue?.method === "reported" &&
            p.metricSources.revenue.tag === total.tag &&
            p.metricSources.revenue.sourceUrl === p.sourceUrl &&
            p.metricSources.revenue.accession === p.accession &&
            p.metricSources.revenue.filedAt === p.filedAt,
          "Selected revenue differs from preserved original source"
        );
        if (p.metrics.incomeTax !== undefined)
          demand(
            p.metricSources.incomeTax?.method === "reported" &&
              p.metricSources.incomeTax.tag === anchor[0].tax.fact!.tag &&
              p.metricSources.incomeTax.sourceUrl === p.sourceUrl &&
              p.metricSources.incomeTax.accession === p.accession &&
              p.metricSources.incomeTax.filedAt === p.filedAt &&
              (p.metrics.incomeTax === anchor[0].tax.fact!.value ||
                (Number.isSafeInteger(p.metrics.incomeTax) &&
                  BigInt(p.metrics.incomeTax) === originalExactMillionDollars(anchor[0].tax))),
            "Preserved tax disagrees with independent original " +
              p.id +
              " saved=" +
              p.metrics.incomeTax +
              " original=" +
              anchor[0].tax.fact!.value
          );
        selected.push({
          tableIndex: table.tableIndex,
          row,
          cells: money,
          headers,
          profile: profile[0]
        });
      }
    }
  }
  demand(
    used.size === primary.length &&
      primary.every((p) => used.has(p.scope.start + "|" + p.scope.end)) &&
      selected.length === 1,
    "Incomplete original current/comparative/cumulative business columns"
  );
  const s = selected[0]!,
    labels = ["Olive Garden", "LongHorn Steakhouse", "Fine Dining", "Other Business"];
  const segments: RevenueSegment[] = s.cells.slice(0, 4).map((c, i) => ({
    id: `reported-${labels[i]}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    label: labels[i],
    revenue: c.fact!.value,
    revenueSource: {
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      filedAt: p.filedAt,
      startDate: p.startDate,
      endDate: p.endDate,
      currency: "USD",
      tag: c.fact!.tag,
      dimensions: c.fact!.dimensions,
      value: c.fact!.value,
      decimals: c.fact!.decimals,
      tableLabel: s.headers[i].label,
      rowLabel: "Sales",
      rowIndex: s.row.rowIndex,
      columnIndex: c.columnIndex
    }
  }));
  return {
    segments,
    tableIndex: s.tableIndex,
    totalDecimals: s.cells[5].fact!.decimals,
    totalLabel: "Consolidated",
    originalCorporateZero: {
      label: "Corporate",
      tag: s.cells[4].fact!.tag,
      dimensions: s.cells[4].fact!.dimensions,
      value: 0 as const,
      decimals: s.cells[4].fact!.decimals,
      columnIndex: s.cells[4].columnIndex
    }
  };
}

export function dardenRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.dardenRevenue;
    demand(
      s?.method === "reviewed-darden-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.totalLabel === "Consolidated" &&
        s.omittedSubtotals.length === 0 &&
        !p.revenueAdjustments?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === dardenRevenueBasis,
      "Invalid original Darden business proof envelope"
    );
    const allowed = [
      "method",
      "ruleId",
      "tableIndex",
      "totalTableIndex",
      "sourceUrl",
      "accession",
      "revenueTag",
      "revenue",
      "revenueDecimals",
      "totalLabel",
      "omittedSubtotals",
      "omittedZeroColumns",
      "dardenRevenue"
    ];
    demand(
      Object.keys(s).every((k) => allowed.includes(k)),
      "Mixed or unsupported original Darden business proof"
    );
    const original = originalDardenRevenuePartition(p, proof);
    demand(
      s.tableIndex === original.tableIndex &&
        s.revenueDecimals === original.totalDecimals &&
        canonicalDardenSource(s.omittedZeroColumns) ===
          canonicalDardenSource([original.originalCorporateZero]) &&
        canonicalDardenSource(p.segments) === canonicalDardenSource(original.segments),
      "Original Darden businesses or zero scope were altered"
    );
  } catch (e) {
    return e instanceof Error ? e.message : "Malformed original Darden revenue proof";
  }
}
