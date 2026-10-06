import type {
  RevenueSegment,
  ServiceRevenueCell,
  ServiceRevenueRow,
  ServiceRevenueRowsProof
} from "./types";
import type { PeriodV2 } from "./v2-types";
import { sameDimensions } from "./business-rules";

export const serviceRevenueTag = "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax";
export const serviceRevenueAxis = "us-gaap:ContractWithCustomerSalesChannelAxis";
export const akamaiServiceProfiles = [
  [
    "web-media",
    [
      ["Web Division", "WebDivision"],
      ["Media and Carrier Division", "MediaandCarrierDivision"]
    ]
  ],
  [
    "technology-groups",
    [
      ["Security Technology Group", "SecurityTechnologyGroup"],
      ["Edge Technology Group", "EdgeTechnologyGroup"]
    ]
  ],
  // The original 2021 labels changed while the original member QNames did not.
  [
    "technology-groups-legacy-members",
    [
      ["Security Technology Group", "WebDivision"],
      ["Edge Technology Group", "MediaandCarrierDivision"]
    ]
  ],
  [
    "security-delivery-compute",
    [
      ["Security", "Security"],
      ["Delivery", "Delivery"],
      ["Compute", "Compute"]
    ]
  ],
  [
    "security-delivery-cloud",
    [
      ["Security", "Security"],
      ["Delivery", "Delivery"],
      ["Cloud computing", "CloudComputing"]
    ]
  ],
  [
    "security-applications-infrastructure",
    [
      ["Security", "Security"],
      ["Delivery and other cloud applications", "DeliveryAndOtherCloudApplications"],
      ["Cloud infrastructure services", "CloudInfrastructureServices"]
    ]
  ]
] as const;
export const serviceRevenueBasis =
  "Reported Akamai service revenue in the original source classification. The complete source rows reconcile exactly to both their closing total and the independent consolidated income-statement revenue. Historical labels and source scopes are retained; no business amount is estimated.";
const ruleId = (name: string) => `akam-original-service-rows-${name}-v1`;
export class ServiceRevenueProofError extends Error {}
function requireProof(value: unknown, reason: string): asserts value {
  if (!value) throw new ServiceRevenueProofError(reason);
}
const integer = (n: number, max = 5000) => Number.isInteger(n) && n >= 0 && n <= max;
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const primaryScope = (d: Record<string, string>) =>
  !Object.keys(d).length ||
  sameDimensions(d, { "us-gaap:StatementBusinessSegmentsAxis": "akam:ReportableSegmentMember" });
function validRows(rows: ServiceRevenueRow[], units: ServiceRevenueRowsProof["units"]) {
  const occupied = new Set<string>();
  for (const row of rows) {
    requireProof(
      integer(row.rowIndex, 100) &&
        Array.isArray(row.cells) &&
        row.cells.length >= 1 &&
        row.cells.length <= 64,
      "Invalid original row"
    );
    let next = 0;
    for (const c of row.cells) {
      requireProof(
        integer(c.columnIndex, 64) &&
          integer(c.span, 64) &&
          c.span >= 1 &&
          integer(c.rowSpan, 2) &&
          c.rowSpan >= 1 &&
          (!c.fact || c.rowSpan === 1) &&
          typeof c.label === "string" &&
          c.label.length <= 250,
        "Invalid physical source grid"
      );
      while (occupied.has(`${row.rowIndex}:${next}`)) next++;
      requireProof(c.columnIndex === next, "Source columns differ from original row spans");
      for (let y = 0; y < c.rowSpan; y++)
        for (let x = 0; x < c.span; x++) {
          const key = `${row.rowIndex + y}:${next + x}`;
          requireProof(!occupied.has(key), "Overlapping original cells");
          occupied.add(key);
        }
      next += c.span;
      requireProof(next <= 64, "Oversized original row");
      if (!c.fact) continue;
      const f = c.fact,
        d = f.declarations?.[0];
      const corroboration = f.corroboratingContexts ?? [];
      requireProof(
        Array.isArray(corroboration) &&
          corroboration.length <= 1 &&
          corroboration.every(
            (x) =>
              x.contextId &&
              x.contextId !== f.contextId &&
              x.dimensions &&
              primaryScope(x.dimensions) &&
              primaryScope(f.dimensions) &&
              !sameDimensions(x.dimensions, f.dimensions)
          ),
        "Invalid original nested corroboration"
      );
      requireProof(
        f.currency === "USD" &&
          Number(f.cik) === 1086222 &&
          f.contextId &&
          f.contextId.length <= 1000 &&
          date(f.startDate) &&
          date(f.endDate) &&
          f.startDate < f.endDate &&
          f.dimensions &&
          Number.isSafeInteger(f.value) &&
          f.decimals === -3 &&
          d &&
          Array.isArray(f.declarations) &&
          f.declarations.length >= 1 &&
          f.declarations.length <= 2 &&
          f.declarations.every(
            (x) =>
              x.tag === f.tag &&
              (x.contextId === f.contextId ||
                corroboration.some((c) => c.contextId === x.contextId)) &&
              x.unitRef === d.unitRef &&
              x.scale === d.scale &&
              x.format === d.format &&
              x.sign === d.sign
          ) &&
          d.scale === 3 &&
          units.some((u) => u.id === d.unitRef) &&
          /^ixt:num(?:dotdecimal|-dot-decimal)$/.test(d.format) &&
          (d.sign === undefined || d.sign === "-"),
        "Invalid original fact or declaration"
      );
      requireProof(
        corroboration.every((c) => f.declarations.some((d) => d.contextId === c.contextId)) &&
          f.declarations.some((d) => d.contextId === f.contextId),
        "Original nested context is missing its declaration"
      );
      const label = c.label.replace(/[,\s$]/g, "");
      // A printed opening/closing parenthesis may be a separate physical cell.
      const lexical = label.replace(/^[(-]|\)$/g, "");
      requireProof(
        /^\d+(?:\.\d+)?$/.test(lexical) &&
          // Expense parentheses express a deduction in the displayed statement;
          // the original XBRL sign, not those parentheses, defines the fact value.
          Number(lexical) * 1e3 === Math.abs(f.value) &&
          (d.sign === "-") === f.value < 0,
        "Visible amount differs from the original fact"
      );
    }
  }
}
function current(c: ServiceRevenueCell, p: PeriodV2) {
  return c.fact?.startDate === p.startDate && c.fact.endDate === p.endDate;
}
function periodCell(
  rows: ServiceRevenueRow[],
  row: ServiceRevenueRow,
  p: PeriodV2
): ServiceRevenueCell {
  const headings = rows
    .flatMap((r) => r.cells.map((c) => ({ rowIndex: r.rowIndex, ...c })))
    .filter((c) => !c.fact && c.rowIndex < row.rowIndex);
  const years = headings.filter((c) => c.label === p.endDate.slice(0, 4));
  const temporal =
    p.kind === "quarterly"
      ? headings.filter((c) => {
          const month = (
            { "03": "March", "06": "June", "09": "September", "12": "December" } as Record<
              string,
              string
            >
          )[p.endDate.slice(5, 7)];
          return c.label === `For the Three Months Ended ${month} ${Number(p.endDate.slice(8))},`;
        })
      : [];
  const matches = years.flatMap((y) => {
    if (
      p.kind === "quarterly" &&
      !temporal.some(
        (t) =>
          t.rowIndex < y.rowIndex &&
          y.columnIndex >= t.columnIndex &&
          y.columnIndex + y.span <= t.columnIndex + t.span
      )
    )
      return [];
    const selected = row.cells.filter(
      (c) =>
        c.columnIndex >= y.columnIndex && c.columnIndex + c.span <= y.columnIndex + y.span && c.fact
    );
    return selected.length === 1 && current(selected[0], p) ? [selected[0]] : [];
  });
  requireProof(
    matches.length === 1 && row.cells.filter((c) => current(c, p)).length === 1,
    "Missing or ambiguous original period column"
  );
  return matches[0];
}

/** No general permission for sales-channel axes: only these original Akamai
 * caption/member combinations can produce a business-revenue partition.
 */
export function serviceRevenueSegments(
  p: PeriodV2,
  proof: ServiceRevenueRowsProof
): RevenueSegment[] {
  requireProof(
    typeof p.accession === "string" && /^\d{10}-\d{2}-\d{6}$/.test(p.accession),
    "Missing original accession"
  );
  requireProof(
    p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1086222\//.test(p.sourceUrl) &&
      p.sourceUrl.startsWith(
        `https://www.sec.gov/Archives/edgar/data/1086222/${p.accession.replaceAll("-", "")}/`
      ) &&
      !new URL(p.sourceUrl).username &&
      !new URL(p.sourceUrl).password,
    "Foreign service source"
  );
  requireProof(
    date(p.startDate) &&
      date(p.endDate) &&
      date(proof.reportDate) &&
      proof.reportDate >= p.endDate &&
      proof.reportDate <= p.filedAt &&
      /^(10-K|10-Q)(\/A)?$/.test(proof.form),
    "Invalid original period metadata"
  );
  const days = (Date.parse(p.endDate) - Date.parse(p.startDate)) / 86400000;
  requireProof(
    p.kind === "annual"
      ? days >= 330 &&
          days <= 400 &&
          p.startDate.endsWith("-01-01") &&
          p.endDate.endsWith("-12-31") &&
          /^10-K/.test(proof.form)
      : days >= 75 && days <= 105,
    "Unreviewed service duration"
  );
  requireProof(
    p.metricSources.revenue?.method === "reported" &&
      p.metricSources.revenue.tag === serviceRevenueTag &&
      p.metricSources.revenue.sourceUrl === p.sourceUrl &&
      p.metricSources.revenue.accession === p.accession &&
      p.metricSources.revenue.filedAt === p.filedAt &&
      !p.revenueAdjustments?.length,
    "Uncorroborated revenue"
  );
  requireProof(
    Array.isArray(proof.units) &&
      proof.units.length >= 1 &&
      proof.units.length <= 20 &&
      proof.units.every((u) => u.id && u.measure === "iso4217:USD") &&
      new Set(proof.units.map((u) => u.id)).size === proof.units.length,
    "Invalid original USD units"
  );
  requireProof(
    integer(proof.tableIndex) &&
      Array.isArray(proof.rows) &&
      proof.rows.length >= 5 &&
      proof.rows.length <= 10 &&
      proof.rows.every((r, i) => r.rowIndex === i),
    "Incomplete original table rows"
  );
  validRows(proof.rows, proof.units);
  const first = proof.rows.findIndex((r) => r.cells.some((c) => c.fact));
  requireProof(first >= 1, "Missing original headers");
  const headers = proof.rows.slice(0, first),
    body = proof.rows.slice(first);
  requireProof(
    headers.every((r) =>
      r.cells.every(
        (c) =>
          !c.fact &&
          (!c.label ||
            /^\d{4}$/.test(c.label) ||
            /^For the (?:Three|Six|Nine) Months Ended (?:March|June|September|December) \d{1,2},$/.test(
              c.label
            ))
      )
    ),
    "Unknown original table heading"
  );
  const captions = body.slice(0, -1).map((r) => r.cells[0].label);
  const profile = akamaiServiceProfiles.find(
    ([name, branches]) =>
      ruleId(name) === proof.ruleId && canonical(branches.map((b) => b[0])) === canonical(captions)
  );
  requireProof(profile, "Unreviewed service classification");
  requireProof(
    body.at(-1)!.cells[0].label === "Total revenue" && body.length === profile[1].length + 1,
    "Missing original closing total"
  );
  const leaves: ServiceRevenueCell[] = [];
  for (const [index, row] of body.entries()) {
    const branch = profile[1][index];
    for (const c of row.cells.slice(1)) {
      requireProof(
        c.fact || !c.label || c.label === "$",
        "Untagged or unknown original monetary cell"
      );
      if (c.fact)
        requireProof(
          c.fact.tag === serviceRevenueTag &&
            c.fact.value >= 0 &&
            !c.fact.corroboratingContexts?.length &&
            (branch
              ? current(c, p)
                ? sameDimensions(c.fact.dimensions, {
                    [serviceRevenueAxis]: `akam:${branch[1]}Member`
                  })
                : akamaiServiceProfiles.some(([, branches]) =>
                    branches.some(
                      ([caption, member]) =>
                        caption === branch[0] &&
                        sameDimensions(c.fact!.dimensions, {
                          [serviceRevenueAxis]: `akam:${member}Member`
                        })
                    )
                  )
              : sameDimensions(c.fact.dimensions, {})),
          "Wrong service member or total scope"
        );
    }
    const c = periodCell(headers, row, p);
    if (index < body.length - 1) leaves.push(c);
    else
      requireProof(
        c.fact!.value === p.metrics.revenue,
        "Closing source total differs from reported revenue"
      );
  }
  requireProof(
    leaves.reduce((n, c) => n + c.fact!.value, 0) === p.metrics.revenue,
    "Original branches do not exactly partition revenue"
  );
  const primary = proof.primary;
  requireProof(
    primary &&
      integer(primary.tableIndex) &&
      primary.tableIndex !== proof.tableIndex &&
      /^(?:AKAMAI TECHNOLOGIES, INC\. )?(?:CONDENSED )?CONSOLIDATED STATEMENTS OF INCOME$/.test(
        primary.title
      ) &&
      Array.isArray(primary.headerRows) &&
      primary.headerRows.length >= 1 &&
      primary.headerRows.length <= 5 &&
      primary.headerRows.every((r, i) => r.rowIndex === i) &&
      primary.revenue.rowIndex === primary.headerRows.length &&
      primary.tax.rowIndex > primary.revenue.rowIndex,
    "Missing independent consolidated statement"
  );
  validRows([...primary.headerRows, primary.revenue, primary.tax], proof.units);
  requireProof(
    primary.headerRows.every((r) => r.cells.every((c) => !c.fact)) &&
      primary.revenue.cells[0].label === "Revenue" &&
      /^Provision for income taxes|^Income tax (?:expense|benefit)/i.test(
        primary.tax.cells[0].label
      ),
    "Changed original primary anchors"
  );
  const revenue = periodCell(primary.headerRows, primary.revenue, p).fact!,
    tax = periodCell(primary.headerRows, primary.tax, p).fact!;
  requireProof(
    revenue.tag === serviceRevenueTag &&
      revenue.value === p.metrics.revenue &&
      primaryScope(revenue.dimensions) &&
      tax.tag === "us-gaap:IncomeTaxExpenseBenefit" &&
      primaryScope(tax.dimensions) &&
      (p.metrics.incomeTax === undefined || p.metrics.incomeTax === tax.value),
    "Primary amount or scope conflicts with reported financials"
  );
  return leaves.map((c, i) => {
    const f = c.fact!,
      label = profile[1][i][0];
    return {
      id: `reported-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
      label,
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
        tableLabel: label,
        rowLabel: label,
        rowIndex: body[i].rowIndex,
        columnIndex: c.columnIndex
      }
    };
  });
}
export function serviceRevenueRowsProblem(p: PeriodV2): string | undefined {
  try {
    const source = p.businessBreakdownSource,
      proof = source?.serviceRevenueRows;
    requireProof(
      source?.method === "reviewed-service-revenue-rows" &&
        proof &&
        source.ruleId === proof.ruleId &&
        source.tableIndex === proof.tableIndex &&
        source.totalTableIndex === proof.primary.tableIndex &&
        source.sourceUrl === p.sourceUrl &&
        source.accession === p.accession &&
        source.revenueTag === serviceRevenueTag &&
        source.revenue === p.metrics.revenue &&
        source.revenueDecimals === -3 &&
        source.totalLabel === "Total revenue" &&
        source.omittedSubtotals.length === 0 &&
        !source.productPortfolios &&
        !source.axis &&
        !source.qualifiers &&
        !source.externalCustomerColumns &&
        !source.omittedZeroColumns?.length &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === serviceRevenueBasis,
      "Invalid service revenue proof"
    );
    requireProof(
      canonical(p.segments) === canonical(serviceRevenueSegments(p, proof)),
      "Business values differ from original service rows"
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid service rows";
  }
}
