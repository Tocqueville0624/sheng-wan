import type { BacOriginalNote, BacRevenueProof } from "./bac-types";
import type { PeriodV2 } from "./v2-types";
import type { RevenueSegment, ServiceRevenueCell, ServiceRevenueRow } from "./types";
import { decodeBacRows, packBacOriginalRows } from "./bac-original-rows";
import { originalBacMillionDollarRows, originalExactMillionDollars } from "./original-revenue-rows";
import { parseInlineXbrl } from "../../../scripts/finance/ixbrl";

function demand(v: unknown, reason: string): asserts v {
  if (!v) throw Error(reason);
}
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
const attribute = (s: string, k: string) => s.match(new RegExp(`\\b${k}=["']([^"']+)["']`))?.[1];
const text = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const revenueTag = "bac:RevenuesNetOfInterestExpenseFullTaxEquivalentBasis",
  interestTag = "bac:InterestIncomeExpenseNetFullTaxEquivalentBasis",
  adjustmentTag = "bac:InterestIncomeExpenseNetFullTaxEquivalentBasisAfterTax";
const labels = [
  "Total Corporation",
  "Consumer Banking",
  "Global Wealth & Investment Management",
  "Global Banking",
  "Global Markets",
  "All Other"
];
const members = [
  "",
  "bac:ConsumerBankingSegmentMember",
  "bac:GlobalWealthAndInvestmentManagementSegmentMember",
  "bac:GlobalBankingSegmentMember",
  "bac:GlobalMarketsSegmentMember",
  "bac:CorporateReconcilingItemsAndEliminationsMember"
];
const dims = members.map((member, i) =>
  i === 0
    ? {}
    : i === 5
      ? { "srt:ConsolidationItemsAxis": member }
      : {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
);
const key = (f: NonNullable<ServiceRevenueCell["fact"]>) => f.startDate + "|" + f.endDate;
const tableIndex = (i: number) => Number.isInteger(i) && i >= 0 && i < 5000;
const facts = (r: ServiceRevenueRow) => r.cells.filter((c) => c.fact);
const exact = originalExactMillionDollars;
const months: Record<string, string> = {
  "March 31": "03-31",
  "June 30": "06-30",
  "September 30": "09-30",
  "December 31": "12-31"
};
const duration = (caption: string) => {
  const m = caption.match(
    /^(?:At and for the |)(year|three months|six months|nine months) ended (March 31|June 30|September 30|December 31)$/i
  );
  demand(m, "Unreviewed original BAC duration heading");
  return {
    count: (
      { year: 12, "three months": 3, "six months": 6, "nine months": 9 } as Record<string, number>
    )[m[1].toLowerCase()],
    end: months[m[2]]
  };
};
function sourceScope(year: number, d: { count: number; end: string }) {
  const end = year + "-" + d.end,
    endMonth = Number(d.end.slice(0, 2));
  demand(
    d.count <= endMonth && endMonth % 3 === 0 && (d.count !== 12 || d.end === "12-31"),
    "Unreviewed BAC fiscal geometry"
  );
  return { start: `${year}-${String(endMonth - d.count + 1).padStart(2, "0")}-01`, end };
}
function yearForCell(c: ServiceRevenueCell, r: ServiceRevenueRow) {
  const h = r.cells.filter(
    (h) =>
      /^20\d{2}$/.test(h.label) &&
      c.columnIndex >= h.columnIndex &&
      c.columnIndex + c.span <= h.columnIndex + h.span
  );
  demand(h.length === 1, "Original BAC amount lacks its exact year column");
  return Number(h[0].label);
}
function monetaryRow(r: ServiceRevenueRow, n: number) {
  demand(
    !r.cells[0].fact &&
      facts(r).length === n &&
      r.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label)),
    "Missing or unaccounted BAC original monetary cell"
  );
}

export const bacRevenueBasis =
  "Reported BAC business revenues are net of interest expense and presented on a fully taxable-equivalent (FTE) basis. All Other retains its reported signed contribution; the separately reported FTE basis adjustment is deducted to reconcile to GAAP consolidated revenue. Every original current, comparative and cumulative column is checked. Original comparative member names remain in the evidence; the independently reported nondimensional primary statement establishes the GAAP scope. Business gross profit and missing quarterly business splits are not estimated.";

function noteFacts(note: BacOriginalNote, proof: BacRevenueProof) {
  // The reviewed March Q1 sources retain the previous annual taxonomy release.
  const taxonomyYear = proof.originalFiscalYear - (proof.reportDate.endsWith("-03-31") ? 1 : 0);
  demand(
    Object.keys(note).every((k) =>
      [
        "offset",
        "endOffset",
        "html",
        "root",
        "closingRoot",
        "contexts",
        "units",
        "metadata"
      ].includes(k)
    ) &&
      Number.isSafeInteger(note.offset) &&
      note.offset >= 0 &&
      note.endOffset === note.offset + note.html.length &&
      note.html.length <= 10000 &&
      /^<div\b/.test(note.html) &&
      /<\/div>$/.test(note.html) &&
      note.root.length <= 10000 &&
      /^<html\b[^>]*>$/.test(note.root) &&
      /^<\/html\s*>$/i.test(note.closingRoot),
    "Invalid unchanged BAC footnote excerpt"
  );
  for (const [fragments, max] of [
    [note.contexts, 3],
    [note.units, 2],
    [note.metadata, 3]
  ] as const)
    demand(
      Array.isArray(fragments) &&
        fragments.length > 0 &&
        fragments.length <= max &&
        fragments.every((s) => typeof s === "string" && s.length > 0 && s.length < 10000) &&
        new Set(fragments).size === fragments.length,
      "Invalid original BAC note resources"
    );
  for (const [prefix, uri] of Object.entries({
    ix: "http://www.xbrl.org/2013/inlineXBRL",
    ixt: "http://www.xbrl.org/inlineXBRL/transformation/2020-02-12",
    xbrli: "http://www.xbrl.org/2003/instance",
    xbrldi: "http://xbrl.org/2006/xbrldi",
    iso4217: "http://www.xbrl.org/2003/iso4217",
    "us-gaap": `http://fasb.org/us-gaap/${taxonomyYear}`,
    dei: `http://xbrl.sec.gov/dei/${taxonomyYear}`,
    bac: `http://www.bankofamerica.com/${proof.reportDate.replaceAll("-", "")}`
  }))
    demand(
      attribute(note.root, `xmlns:${prefix}`) === uri &&
        [note.html, ...note.contexts, ...note.units, ...note.metadata].every(
          (s) => !/\bxmlns(?::[\w.-]+)?\s*=/.test(s)
        ),
      "Changed original BAC note namespace binding"
    );
  const declarations = [
    ...note.html.matchAll(/<ix:nonFraction\b[^>]*>[\s\S]*?<\/ix:nonFraction>/gi)
  ].map(([x]) => x);
  demand(
    declarations.length >= 2 && declarations.length <= 3,
    "Incomplete original BAC FTE note amounts"
  );
  const normalized = text(note.html)
    .replace(/\$\s*\d[\d,]*\s*million/g, "$ AMOUNT million")
    .replace(/20\d{2}/g, "YEAR");
  demand(
    /^\(1\) Segment results are presented on an FTE basis and include additional net interest income and income tax expense, related to tax-exempt securities, of \$ AMOUNT million(?:, \$ AMOUNT million)? and \$ AMOUNT million (?:in YEAR, YEAR and YEAR|for the (?:three|six|nine) months ended (?:March 31|June 30|September 30), YEAR and YEAR), respectively, as compared to the Consolidated Statement of Income\.$/.test(
      normalized
    ),
    "Changed original BAC note basis or comparative order"
  );
  const p = parseInlineXbrl(
    [
      note.root,
      ...note.contexts,
      ...note.units,
      ...note.metadata,
      note.html,
      note.closingRoot
    ].join("\n")
  );
  demand(
    p.periodEnd === proof.reportDate &&
      p.fiscalYear === proof.originalFiscalYear &&
      p.fiscalPeriod === proof.originalFiscalPeriod &&
      p.facts.length === declarations.length,
    "Original BAC note resource or focus mismatch"
  );
  const years = [...text(note.html).matchAll(/20\d{2}/g)].map((m) => Number(m[0]));
  const date = normalized.includes(" in YEAR")
    ? { count: 12, end: "12-31" }
    : duration(
        text(note.html).match(
          /for the ((?:three|six|nine) months ended (?:March 31|June 30|September 30))/
        )![1]
      );
  demand(
    years.length === declarations.length &&
      years.every((y, i) => y === proof.originalFiscalYear - i),
    "Original BAC note year order changed"
  );
  return declarations.map((raw, i) => {
    const opening = raw.match(/^<[^>]*>/)![0],
      lexical = text(raw),
      f = p.facts.find(
        (f) => f.tag === adjustmentTag && f.context.id === attribute(opening, "contextRef")
      ),
      scope = sourceScope(years[i], date);
    demand(
      f &&
        f.currency === "USD" &&
        Number(f.context.cik) === 70858 &&
        !f.context.typed &&
        !Object.keys(f.context.dimensions).length &&
        f.context.start === scope.start &&
        f.context.end === scope.end &&
        f.decimals === -6 &&
        Number.isSafeInteger(f.value) &&
        f.value >= 0 &&
        /^\d[\d,]*$/.test(lexical) &&
        Number(lexical.replaceAll(",", "")) * 1000000 === f.value &&
        attribute(opening, "name") === adjustmentTag &&
        attribute(opening, "scale") === "6" &&
        attribute(opening, "decimals") === "-6" &&
        !attribute(opening, "sign") &&
        /^(?:ixt:(?:numdotdecimal|num-dot-decimal))?$/.test(attribute(opening, "format") ?? "") &&
        note.contexts.filter((x) => attribute(x.match(/^<[^>]*>/)![0], "id") === f.context.id)
          .length === 1 &&
        note.units.filter(
          (x) =>
            attribute(x.match(/^<[^>]*>/)![0], "id") === attribute(opening, "unitRef") &&
            text(x) === "iso4217:USD"
        ).length === 1,
      "Changed original BAC reported FTE adjustment declaration"
    );
    return {
      tag: f.tag,
      value: f.value,
      decimals: f.decimals,
      startDate: scope.start,
      endDate: scope.end,
      dimensions: f.context.dimensions,
      tableLabel: "Reported additional net interest income on an FTE basis",
      noteOffset: note.offset
    };
  });
}

export function originalBacRevenuePartition(p: PeriodV2, proof: BacRevenueProof) {
  demand(
    Object.keys(proof).every((k) =>
      [
        "ruleId",
        "encoding",
        "resources",
        "reportDate",
        "form",
        "originalFiscalYear",
        "originalFiscalPeriod",
        "units",
        "primary",
        "business",
        "reconciliation",
        "originalNotes"
      ].includes(k)
    ) &&
      proof.ruleId === "bac-original-complete-revenue-v1" &&
      proof.encoding === "bac-original-resource-tuples-v1",
    "Unreviewed mixed BAC revenue proof"
  );
  const u = new URL(p.sourceUrl),
    directory = `/Archives/edgar/data/70858/${p.accession?.replaceAll("-", "")}/`;
  demand(
    u.origin === "https://www.sec.gov" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.startsWith(directory) &&
      /^[\w.-]+$/.test(u.pathname.slice(directory.length)) &&
      p.reportingCurrency === "USD" &&
      p.displayCurrency === "USD" &&
      !p.fx &&
      proof.reportDate <= p.filedAt &&
      proof.reportDate.slice(0, 4) === String(proof.originalFiscalYear) &&
      (proof.form === "10-K"
        ? proof.originalFiscalPeriod === "FY" && proof.reportDate.endsWith("-12-31")
        : proof.form === "10-Q" &&
          /^Q[1-3]$/.test(proof.originalFiscalPeriod) &&
          proof.reportDate.slice(5) ===
            ["03-31", "06-30", "09-30"][Number(proof.originalFiscalPeriod.slice(1)) - 1]),
    "Invalid original BAC source fiscal identity"
  );
  demand(
    Object.keys(proof.primary).every((k) => ["tableIndex", "rows"].includes(k)) &&
      tableIndex(proof.primary.tableIndex) &&
      Array.isArray(proof.business) &&
      proof.business.length >= 1 &&
      proof.business.length <= 2 &&
      new Set([
        proof.primary.tableIndex,
        ...proof.business.map((b) => b.tableIndex),
        ...(proof.reconciliation ? [proof.reconciliation.tableIndex] : [])
      ]).size ===
        1 + proof.business.length + (proof.reconciliation ? 1 : 0) &&
      !!proof.reconciliation !== !!proof.originalNotes?.length,
    "Ambiguous original BAC proof regions"
  );
  const regions = [
    proof.primary,
    ...proof.business,
    ...(proof.reconciliation ? [proof.reconciliation] : [])
  ];
  demand(
    regions.every(
      (r) =>
        Object.keys(r).every((k) => ["tableIndex", "rows"].includes(k)) && tableIndex(r.tableIndex)
    ),
    "Changed original BAC proof region"
  );
  const completeGroups = regions.map((r) => decodeBacRows(r.rows, proof.resources));
  const repacked = packBacOriginalRows(completeGroups);
  demand(
    canonical(repacked.resources) === canonical(proof.resources) &&
      canonical(repacked.rows) === canonical(regions.map((r) => r.rows)),
    "BAC source dictionaries contain unaccounted or duplicate resources"
  );
  const primary = decodeBacRows(proof.primary.rows, proof.resources);
  originalBacMillionDollarRows(primary, proof.units);
  demand(
    primary.every((r, i) => r.rowIndex === i) &&
      primary.filter((r) => r.cells.some((c) => c.label === "Consolidated Statement of Income"))
        .length === 1 &&
      primary.some((r) => r.cells[0].label === "(In millions, except per share information)") &&
      primary.at(-1)?.cells[0].label === "Total revenue, net of interest expense",
    "Incomplete original BAC primary revenue section"
  );
  const anchorRows = ["us-gaap:InterestIncomeExpenseNet", "us-gaap:NoninterestIncome"].map(
    (tag) => {
      const found = primary.filter((r) => facts(r).some((c) => c.fact!.tag === tag));
      demand(found.length === 1, "Missing unique original BAC primary anchor");
      return found[0];
    }
  );
  const revenueRow = primary.at(-1)!;
  demand(
    facts(revenueRow).every((c) =>
      ["us-gaap:Revenues", "bac:RevenuesNetOfInterestExpenseBeforeProvisionForLoanLoss"].includes(
        c.fact!.tag
      )
    ),
    "Unreviewed original BAC primary revenue concept"
  );
  anchorRows.push(revenueRow);
  const primaryColumns = facts(anchorRows[2]);
  demand(
    primaryColumns.length ===
      (proof.form === "10-K" ? 3 : proof.originalFiscalPeriod === "Q1" ? 2 : 4),
    "Missing original BAC primary comparison or YTD column"
  );
  const yearRows = primary.filter((r) => r.cells.some((c) => /^20\d{2}$/.test(c.label)));
  demand(yearRows.length === 1, "Missing original BAC primary year band");
  const anchors = new Map<
    string,
    { revenue: ServiceRevenueCell; interest: ServiceRevenueCell; noninterest: ServiceRevenueCell }
  >();
  for (const c of primaryColumns) {
    const f = c.fact!,
      year = yearForCell(c, yearRows[0]);
    const bands = primary
      .flatMap((r) => r.cells)
      .filter((h) => /^(?:Three|Six|Nine) Months Ended /.test(h.label));
    const ds =
      proof.originalFiscalPeriod === "Q1" &&
      bands.length === 1 &&
      bands[0].label === "Three Months Ended March 31"
        ? bands
        : bands.filter(
            (h) =>
              c.columnIndex >= h.columnIndex && c.columnIndex + c.span <= h.columnIndex + h.span
          );
    demand(
      proof.form === "10-K" ? !ds.length : ds.length === 1,
      "Original BAC primary duration band missing"
    );
    const d =
        proof.form === "10-K"
          ? { count: 12, end: "12-31" }
          : duration(
              ds[0].label
                .toLowerCase()
                .replace(/march 31/, "March 31")
                .replace(/june 30/, "June 30")
                .replace(/september 30/, "September 30")
            ),
      scope = sourceScope(year, d);
    demand(
      !Object.keys(f.dimensions).length &&
        f.startDate === scope.start &&
        f.endDate === scope.end &&
        !anchors.has(key(f)),
      "Changed original BAC primary period or scope"
    );
    const cells = anchorRows.map((r) => {
      monetaryRow(r, primaryColumns.length);
      const match = facts(r).filter(
        (x) => key(x.fact!) === key(f) && !Object.keys(x.fact!.dimensions).length
      );
      demand(match.length === 1, "Incomplete original BAC primary column");
      return match[0];
    });
    demand(
      exact(cells[0]) + exact(cells[1]) === exact(cells[2]),
      "Original BAC primary interest and noninterest do not reconcile"
    );
    anchors.set(key(f), { interest: cells[0], noninterest: cells[1], revenue: cells[2] });
  }
  const primaryMoney = primary.filter((r) => facts(r).length);
  for (const r of primaryMoney) {
    monetaryRow(r, primaryColumns.length);
    for (const c of facts(r)) {
      const f = c.fact!;
      demand(
        anchors.has(key(f)) &&
          !Object.keys(f.dimensions).length &&
          yearForCell(c, yearRows[0]) === Number(f.endDate.slice(0, 4)),
        "Unaccounted original BAC primary monetary scope"
      );
    }
  }
  for (const [k, a] of anchors) {
    const cells = (rows: ServiceRevenueRow[]) =>
      rows.map((r) => {
        const c = facts(r).filter((c) => key(c.fact!) === k);
        demand(c.length === 1, "Incomplete original BAC primary component");
        return c[0];
      });
    const interestIncome = primaryMoney.findIndex((r) =>
      facts(r).every((c) => c.fact!.tag === "us-gaap:InterestAndDividendIncomeOperating")
    );
    const interestExpense = primaryMoney.findIndex((r) =>
      facts(r).every((c) =>
        ["us-gaap:InterestExpense", "us-gaap:InterestExpenseOperating"].includes(c.fact!.tag)
      )
    );
    const netInterest = primaryMoney.indexOf(anchorRows[0]),
      noninterest = primaryMoney.indexOf(anchorRows[1]);
    demand(
      interestIncome >= 0 &&
        interestExpense > interestIncome &&
        netInterest === interestExpense + 1 &&
        noninterest > netInterest + 1 &&
        primaryMoney.at(-1) === revenueRow,
      "Changed original BAC primary component boundaries"
    );
    const income = cells([primaryMoney[interestIncome]])[0],
      expense = cells([primaryMoney[interestExpense]])[0];
    demand(
      exact(income) - exact(expense) === exact(a.interest) &&
        cells(primaryMoney.slice(netInterest + 1, noninterest)).reduce(
          (n, c) => n + exact(c),
          0n
        ) === exact(a.noninterest),
      "Original BAC primary revenue components do not reconcile"
    );
    if (interestIncome > 0)
      demand(
        cells(primaryMoney.slice(0, interestIncome)).reduce((n, c) => n + exact(c), 0n) ===
          exact(income),
        "Incomplete original BAC detailed interest income"
      );
    if (interestExpense > interestIncome + 1)
      demand(
        cells(primaryMoney.slice(interestIncome + 1, interestExpense)).reduce(
          (n, c) => n + exact(c),
          0n
        ) === exact(expense),
        "Incomplete original BAC detailed interest expense"
      );
  }
  const all = new Map<
    string,
    {
      table: number;
      revenues: ServiceRevenueCell[];
      interest: ServiceRevenueCell[];
      noninterest: ServiceRevenueCell[];
    }
  >();
  for (const b of proof.business) {
    demand(
      tableIndex(b.tableIndex) && Object.keys(b).every((k) => ["tableIndex", "rows"].includes(k)),
      "Invalid original BAC business table identity"
    );
    const rows = decodeBacRows(b.rows, proof.resources);
    originalBacMillionDollarRows(rows, proof.units);
    const band = rows.flatMap((r) => r.cells).filter((c) => /^At and for the /.test(c.label));
    demand(band.length === 1, "Missing original BAC business duration band");
    const d = duration(band[0].label);
    const groups = rows.filter((r) =>
        r.cells.some((c) => labels.some((l) => c.label.replace(/ \(\d\)$/, "") === l))
      ),
      names = groups.flatMap((r) =>
        r.cells.map((c) => c.label.replace(/ \(\d\)$/, "")).filter((l) => labels.includes(l))
      );
    demand(
      canonical(names) === canonical(labels) &&
        rows.filter((r) => r.cells.some((c) => c.label === "(Dollars in millions)")).length === 1 &&
        rows.some((r) =>
          r.cells.some((c) =>
            /^Results of Business Segments and All Other(?: \(1\))?$/.test(c.label)
          )
        ) &&
        rows.every((r) =>
          r.cells.every(
            (c) =>
              c.fact ||
              !c.label ||
              labels.includes(c.label.replace(/ \(\d\)$/, "")) ||
              /^20\d{2}$/.test(c.label) ||
              /^(?:Results of Business Segments and All Other(?: \(1\))?|At and for the (?:year|three months|six months|nine months) ended (?:December 31|March 31|June 30|September 30)|\(Dollars in millions\)|Net interest income|Noninterest income|Total revenue, net of interest expense|\$|\))$/.test(
                c.label
              )
          )
        ),
      "Changed or unaccounted original BAC business headings"
    );
    const revenueRows = rows.filter((r) => facts(r).some((c) => c.fact!.tag === revenueTag));
    demand(
      revenueRows.length === (d.count === 12 ? 3 : 2) && groups.length === revenueRows.length,
      "Incomplete original BAC business blocks"
    );
    const count = d.count === 12 ? 3 : 2,
      scopeGroups = new Map<
        string,
        { r: ServiceRevenueCell[]; i: ServiceRevenueCell[]; n: ServiceRevenueCell[] }
      >();
    for (const [j, r] of revenueRows.entries()) {
      const interest = rows.find((x) => x.rowIndex === r.rowIndex - 2),
        noninterest = rows.find((x) => x.rowIndex === r.rowIndex - 1),
        header = rows.find((x) => x.rowIndex === r.rowIndex - 3);
      demand(
        interest?.cells[0].label === "Net interest income" &&
          noninterest?.cells[0].label === "Noninterest income" &&
          r.cells[0].label === "Total revenue, net of interest expense" &&
          header &&
          !facts(header).length &&
          groups[j].rowIndex < header.rowIndex,
        "Incomplete original BAC revenue triplet"
      );
      const expectedLabels = groups[j].cells
          .map((c) => c.label.replace(/ \(\d\)$/, ""))
          .filter((l) => labels.includes(l)),
        amount = facts(r);
      monetaryRow(r, count * expectedLabels.length);
      monetaryRow(interest, amount.length);
      monetaryRow(noninterest, amount.length);
      demand(
        rows
          .filter((x) => x.rowIndex >= groups[j].rowIndex && x.rowIndex <= r.rowIndex)
          .every((x, i, region) => i === 0 || x.rowIndex === region[i - 1].rowIndex + 1),
        "Omitted original BAC block header row"
      );
      for (const [i, c] of amount.entries()) {
        const f = c.fact!,
          businessIndex = labels.indexOf(expectedLabels[Math.floor(i / count)]),
          year = yearForCell(c, header),
          scope = sourceScope(year, d);
        demand(
          f.tag === revenueTag &&
            canonical(f.dimensions) === canonical(dims[businessIndex]) &&
            f.startDate === scope.start &&
            f.endDate === scope.end &&
            year === proof.originalFiscalYear - (i % count),
          "Original BAC business caption, period or scope changed"
        );
        const paired = (row: ServiceRevenueRow, tag: string) => {
            const x = facts(row)[i];
            demand(
              x.fact!.tag === tag &&
                key(x.fact!) === key(f) &&
                canonical(x.fact!.dimensions) === canonical(f.dimensions),
              "Changed original BAC triplet binding"
            );
            return x;
          },
          ic = paired(interest, interestTag),
          nc = paired(noninterest, "us-gaap:NoninterestIncome");
        demand(
          exact(ic) + exact(nc) === exact(c),
          "Original BAC business interest and noninterest do not reconcile"
        );
        if (!scopeGroups.has(key(f))) scopeGroups.set(key(f), { r: [], i: [], n: [] });
        const sg = scopeGroups.get(key(f))!;
        demand(!sg.r[businessIndex], "Duplicate original BAC business scope");
        sg.r[businessIndex] = c;
        sg.i[businessIndex] = ic;
        sg.n[businessIndex] = nc;
      }
    }
    demand(
      rows.filter((r) => facts(r).length).length === revenueRows.length * 3,
      "Unaccounted original BAC monetary row"
    );
    for (const [k, g] of scopeGroups) {
      demand(
        g.r.length === 6 &&
          g.r.every(Boolean) &&
          g.i.length === 6 &&
          g.n.length === 6 &&
          anchors.has(k) &&
          !all.has(k),
        "Missing original BAC business, comparison or primary scope"
      );
      for (const xs of [g.r, g.i, g.n])
        demand(
          xs.slice(1).reduce((n, c) => n + exact(c), 0n) === exact(xs[0]),
          "Original BAC complete business totals do not reconcile"
        );
      demand(
        exact(g.n[0]) === exact(anchors.get(k)!.noninterest),
        "Original BAC noninterest basis differs from GAAP"
      );
      all.set(k, { table: b.tableIndex, revenues: g.r, interest: g.i, noninterest: g.n });
    }
  }
  demand(
    all.size === anchors.size && [...anchors.keys()].every((k) => all.has(k)),
    "Missing complete original BAC comparison/YTD business scope"
  );
  const adjustments = new Map<
    string,
    {
      tag: string;
      value: number;
      decimals: number;
      startDate: string;
      endDate: string;
      dimensions: Record<string, string>;
      tableLabel: string;
      rowIndex?: number;
      columnIndex?: number;
      noteOffset?: number;
    }
  >();
  if (proof.reconciliation) {
    const rec = proof.reconciliation,
      rows = decodeBacRows(rec.rows, proof.resources);
    originalBacMillionDollarRows(rows, proof.units);
    demand(
      tableIndex(rec.tableIndex) && rows.every((r, i) => r.rowIndex === i),
      "Incomplete original BAC reconciliation table"
    );
    const fte = rows.filter((r) => r.cells[0].label === "FTE basis adjustment"),
      total = rows.filter(
        (r) => r.cells[0].label === "Consolidated revenue, net of interest expense"
      ),
      segment = rows.filter(
        (r) => r.cells[0].label === "Segments’ total revenue, net of interest expense"
      );
    demand(
      fte.length === 1 && total.length === 1 && segment.length === 1 && total[0] === rows.at(-1),
      "Changed original BAC reconciliation boundaries"
    );
    const components = rows.filter((r) => facts(r).length);
    demand(
      components.length === 5 &&
        components[0] === segment[0] &&
        components[3] === fte[0] &&
        components[4] === total[0],
      "Missing original BAC reconciliation component"
    );
    demand(
      ["Asset and liability management activities", "ALM activities"].includes(
        components[1].cells[0].label
      ) && components[2].cells[0].label === "Liquidating businesses, eliminations and other",
      "Unreviewed original BAC reconciling business caption"
    );
    const expectedDimensions = [
      { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" },
      {
        "srt:ConsolidationItemsAxis":
          "bac:SegmentReconcilingItemsAssetandLiabilityManagementActivitiesMember"
      },
      {
        "srt:ConsolidationItemsAxis":
          "bac:SegmentReconcilingItemsLiquidatingBusinessesEliminationsandOtherMember"
      },
      {
        "srt:ConsolidationItemsAxis":
          "bac:SegmentReconcilingItemsFullyTaxableEquivalentBasisAdjustmentMember"
      }
    ];
    const years = rows.filter((r) => r.cells.some((c) => /^20\d{2}$/.test(c.label)));
    demand(years.length === 1, "Missing original BAC reconciliation year band");
    for (const c of facts(fte[0])) {
      const f = c.fact!,
        k = key(f),
        g = all.get(k),
        a = anchors.get(k);
      demand(
        g && a && f.tag === "us-gaap:Revenues" && f.value <= 0 && !adjustments.has(k),
        "Foreign or duplicate original BAC FTE adjustment scope"
      );
      const column = components.map((r) => {
        monetaryRow(r, anchors.size);
        const found = facts(r).filter((c) => key(c.fact!) === k);
        demand(found.length === 1, "Incomplete original BAC reconciliation column");
        return found[0];
      });
      demand(
        column.every(
          (c, i) =>
            yearForCell(c, years[0]) === Number(c.fact!.endDate.slice(0, 4)) &&
            c.fact!.tag === (i === 0 ? revenueTag : "us-gaap:Revenues") &&
            (i === 4 || canonical(c.fact!.dimensions) === canonical(expectedDimensions[i]))
        ),
        "Changed original BAC reconciliation tag, year or dimensional scope"
      );
      demand(
        exact(column[0]) === g.revenues.slice(1, 5).reduce((n, c) => n + exact(c), 0n) &&
          exact(column[1]) + exact(column[2]) === exact(g.revenues[5]) &&
          column.slice(0, 4).reduce((n, c) => n + exact(c), 0n) === exact(column[4]) &&
          exact(column[4]) === exact(a.revenue) &&
          [{}, { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" }].some(
            (d) => canonical(d) === canonical(column[4].fact!.dimensions)
          ),
        "Original BAC independent reconciliation fails"
      );
      adjustments.set(k, {
        ...f,
        tableLabel: "FTE basis adjustment",
        rowIndex: fte[0].rowIndex,
        columnIndex: c.columnIndex
      });
    }
  } else {
    demand(
      proof.originalNotes && proof.originalNotes.length === proof.business.length,
      "Missing original BAC FTE comparison footnote"
    );
    for (const note of proof.originalNotes)
      for (const f of noteFacts(note, proof)) {
        const k = f.startDate + "|" + f.endDate;
        demand(!adjustments.has(k), "Duplicate original BAC FTE note scope");
        adjustments.set(k, f);
      }
  }
  demand(
    adjustments.size === all.size,
    "Missing original BAC FTE comparison or cumulative adjustment"
  );
  for (const [k, g] of all) {
    const a = anchors.get(k)!,
      adj = adjustments.get(k);
    demand(adj, "Missing original BAC reported adjustment");
    const deduction = proof.reconciliation ? BigInt(-adj.value) : BigInt(adj.value);
    demand(
      exact(g.revenues[0]) - deduction === exact(a.revenue) &&
        exact(g.interest[0]) - deduction === exact(a.interest),
      "Original reported FTE adjustment does not bridge to GAAP"
    );
  }
  const selectedKey = p.startDate + "|" + p.endDate,
    s = all.get(selectedKey),
    a = anchors.get(selectedKey),
    adj = adjustments.get(selectedKey),
    source = p.metricSources.revenue;
  demand(
    s &&
      a &&
      adj &&
      p.metrics.revenue === a.revenue.fact!.value &&
      source &&
      ["us-gaap:Revenues", "bac:RevenuesNetOfInterestExpenseBeforeProvisionForLoanLoss"].includes(
        source.tag
      ) &&
      source.method === "reported" &&
      source.sourceUrl === p.sourceUrl &&
      source.accession === p.accession &&
      source.filedAt === p.filedAt &&
      (p.kind === "annual"
        ? p.startDate === `${p.fiscalYear}-01-01` && p.endDate === `${p.fiscalYear}-12-31`
        : p.fiscalQuarter &&
          p.startDate ===
            `${p.fiscalYear}-${String(3 * p.fiscalQuarter - 2).padStart(2, "0")}-01` &&
          p.endDate ===
            `${p.fiscalYear}-${["03-31", "06-30", "09-30", "12-31"][p.fiscalQuarter - 1]}`),
    "Selected BAC period differs from its preserved primary source"
  );
  const segments: RevenueSegment[] = [],
    outAdjustments: RevenueSegment[] = [];
  for (let i = 1; i < 6; i++) {
    const c = s.revenues[i],
      f = c.fact!;
    demand(i === 5 || f.value > 0, "Nonpositive original BAC business branch");
    if (!f.value) continue;
    const item: RevenueSegment = {
      id: `bac-${members[i].split(":")[1]}`,
      label: labels[i],
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
        decimals: -6,
        tableLabel: labels[i],
        rowLabel: "Total revenue, net of interest expense",
        columnIndex: c.columnIndex
      }
    };
    (f.value > 0 ? segments : outAdjustments).push(item);
  }
  if (adj.value)
    outAdjustments.push({
      id: "bac-fte-basis-adjustment",
      label: "FTE basis adjustment",
      revenue: proof.reconciliation ? adj.value : -adj.value,
      revenueSource: {
        sourceUrl: p.sourceUrl,
        accession: p.accession!,
        filedAt: p.filedAt,
        startDate: p.startDate,
        endDate: p.endDate,
        currency: "USD",
        tag: adj.tag,
        dimensions: adj.dimensions,
        value: adj.value,
        decimals: -6,
        tableLabel: adj.tableLabel,
        ...(adj.rowIndex !== undefined
          ? { rowIndex: adj.rowIndex, columnIndex: adj.columnIndex }
          : { calculation: { method: "deduct-reported-fte-adjustment" as const } })
      }
    });
  return { segments, adjustments: outAdjustments, tableIndex: s.table };
}

export function bacRevenueProblem(p: PeriodV2): string | undefined {
  try {
    const s = p.businessBreakdownSource,
      proof = s?.bacRevenue;
    demand(
      s?.method === "reviewed-bac-revenue" &&
        proof &&
        s.ruleId === proof.ruleId &&
        s.totalTableIndex === proof.primary.tableIndex &&
        s.sourceUrl === p.sourceUrl &&
        s.accession === p.accession &&
        s.revenue === p.metrics.revenue &&
        s.revenueTag === p.metricSources.revenue?.tag &&
        s.revenueDecimals === -6 &&
        s.totalLabel === "Total revenue, net of interest expense" &&
        p.segmentSourceUrl === p.sourceUrl &&
        p.segmentBasis === bacRevenueBasis &&
        Object.keys(s).every((k) =>
          [
            "method",
            "ruleId",
            "bacRevenue",
            "tableIndex",
            "totalTableIndex",
            "sourceUrl",
            "accession",
            "revenueTag",
            "revenue",
            "revenueDecimals",
            "totalLabel",
            "omittedSubtotals",
            "omittedZeroColumns"
          ].includes(k)
        ) &&
        canonical(s.omittedSubtotals) === "[]" &&
        canonical(s.omittedZeroColumns) === "[]",
      "Changed BAC original proof envelope"
    );
    const replay = originalBacRevenuePartition(p, proof);
    demand(
      s.tableIndex === replay.tableIndex &&
        canonical(p.segments) === canonical(replay.segments) &&
        canonical(p.revenueAdjustments) === canonical(replay.adjustments),
      "BAC businesses or reported deductions differ from original source replay"
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid original BAC revenue proof";
  }
}
