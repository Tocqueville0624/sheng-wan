import type { ServiceRevenueCell, ServiceRevenueRow, ServiceRevenueRowsProof } from "./types";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
import { originalJpmMillionDollarRows } from "./original-revenue-rows";

type Region = {
  tableIndex: number;
  originalRows: ServiceRevenueRow[];
  units?: ServiceRevenueRowsProof["units"];
};
export type JpmOriginalSource = {
  filing: SecFiling;
  originalFocus: { year: number; period: string; end: string };
  regions: Region[];
  originalNotes?: {
    offset: number;
    endOffset: number;
    originalHtml: string;
    originalText: string;
  }[];
};
function demand(value: unknown, message = "Invalid original JPM source semantics"): asserts value {
  if (!value) throw Error(message);
}
function equal(actual: unknown, expected: unknown, message = "Original JPM field changed") {
  demand(actual === expected, message);
}
const canonicalObject = (value: unknown): string =>
  JSON.stringify(value, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x
  );
function equalStructure(
  actual: unknown,
  expected: unknown,
  message = "Original JPM source structure changed"
) {
  demand(canonicalObject(actual) === canonicalObject(expected), message);
}
const tags = [
  "us-gaap:NoninterestIncome",
  "us-gaap:InterestIncomeExpenseNet",
  "us-gaap:RevenuesNetOfInterestExpense"
];
const labels = ["Noninterest revenue", "Net interest income", "Total net revenue"];
const canonical = (v: Record<string, string>) =>
  JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))));
const segment = (member: string) => ({
  "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
  "us-gaap:StatementBusinessSegmentsAxis": member
});
const tail = (v: string) => v.replace(/ \([ab]\)$/, "");
const monthNames: Record<string, string> = {
  "03-31": "March 31",
  "06-30": "June 30",
  "09-30": "September 30",
  "12-31": "December 31"
};

/** Replay finite JPM source meanings. All original physical cells remain intact;
 * captions bind complete ordered groups of original year columns, including
 * the original spacer geometry that extends beyond a caption's colspan.
 * Complete source declarations, primary sums and every date scope must agree. */
export function validateJpmOriginalSemantics(source: JpmOriginalSource, primary: Region) {
  const { filing, originalFocus: focus } = source,
    sourceYear = Number(filing.reportDate.slice(0, 4));
  const units = source.regions[0].units!;
  demand(Array.isArray(units) && units.length > 0 && units.length <= 4);
  equal(new Set(units.map((u) => u.id)).size, units.length);
  demand(
    units.every(
      (u) =>
        u.id &&
        u.measure === "iso4217:USD" &&
        Object.keys(u).every((k) => ["id", "measure"].includes(k))
    )
  );
  originalJpmMillionDollarRows(primary.originalRows, units);
  equal(focus.year, sourceYear);
  equal(focus.end, filing.reportDate);
  demand(
    /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/19617\/\d{18}\/[\w.-]+$/.test(
      filing.sourceUrl
    )
  );
  demand(filing.sourceUrl.includes("/" + filing.accession.replaceAll("-", "") + "/"));
  demand(filing.reportDate <= filing.filedAt);
  demand(sourceYear >= 2018);
  const annual = filing.form === "10-K";
  demand(annual || filing.form === "10-Q");
  const dateTail = filing.reportDate.slice(5),
    quarter = ["03-31", "06-30", "09-30"].indexOf(dateTail) + 1;
  demand(
    annual
      ? dateTail === "12-31" && focus.period === "FY"
      : quarter > 0 && focus.period === "Q" + quarter
  );
  equal(source.regions.length, annual || quarter === 1 ? 2 : 4);
  const merged = filing.reportDate >= "2024-06-30";
  if (["2024-06-30", "2024-09-30"].includes(filing.reportDate)) {
    equal(source.originalNotes?.length, 1, "Original merger evidence missing");
    const note = source.originalNotes![0];
    demand(
      Number.isSafeInteger(note.offset) &&
        note.offset >= 0 &&
        note.endOffset === note.offset + note.originalHtml.length
    );
    demand(
      note.originalHtml.length <= 3000 &&
        /^<div\b/.test(note.originalHtml) &&
        /<\/div>$/.test(note.originalHtml)
    );
    demand(!/<ix:nonFraction\b/i.test(note.originalHtml));
    const text = note.originalHtml
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/\s+/g, " ")
      .trim();
    equal(text, note.originalText, "Original merger excerpt changed");
    const expected =
      "Business Segment Reorganization : Effective in the second quarter of 2024, the Firm reorganized its reportable business segments by combining the former Corporate & Investment Bank and Commercial Banking business segments to form one reportable segment, the Commercial & Investment Bank (“CIB”). As a result of the reorganization, the Firm " +
      (filing.reportDate === "2024-06-30" ? "now " : "") +
      "has three reportable business segments, as well as a Corporate segment. The Firm’s consumer business is the Consumer & Community Banking (“CCB”) segment. The Firm’s wholesale businesses are the Commercial & Investment Bank (“CIB”) and Asset & Wealth Management (“AWM”) segments. Refer to Business Segment Results on pages " +
      (filing.reportDate === "2024-06-30" ? "20-22" : "20-21") +
      " of this Form 10-Q and Recent events on page 52 of the 2023 Form 10-K for additional information on the reorganization, as well as Note 25 of this Form 10-Q and Note 32 of the 2023 Form 10-K, for a description of the Firm’s business segments and the products and services they provide to their respective client bases.";
    equal(text, expected, "Unknown original business merger meaning");
  } else demand(!source.originalNotes?.length, "Unexpected merger evidence profile");
  const cib =
    filing.reportDate >= "2024-12-31"
      ? "jpm:CommercialAndInvestmentBankMember"
      : filing.reportDate >= "2023-06-30"
        ? "jpm:CorporateAndInvestmentBankMember"
        : "jpm:CorporateInvestmentBankMember";
  const expectedBusiness = [
    segment("jpm:ConsumerCommunityBankingMember"),
    segment(cib),
    ...(!merged ? [segment("jpm:CommercialBankingMember")] : []),
    segment("jpm:AssetandWealthManagementSegmentMember")
  ];
  const businessCaptions = [
    "Consumer & Community Banking",
    merged ? "Commercial & Investment Bank" : "Corporate & Investment Bank",
    ...(!merged ? ["Commercial Banking"] : []),
    "Asset & Wealth Management"
  ];
  const expectedCorporate =
    filing.reportDate < "2020-12-31"
      ? segment("us-gaap:CorporateNonSegmentMember")
      : { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" };
  const expectedReconciliation = [
    expectedCorporate,
    { "srt:ConsolidationItemsAxis": "us-gaap:MaterialReconcilingItemsMember" },
    {}
  ];
  const scopeGroups = new Map<
    string,
    {
      dimensions: Record<string, string>;
      values: number[];
      table: number;
      caption: string;
      revenueCell: ServiceRevenueCell;
      revenueRow: number;
    }[]
  >();
  const allFactCells = [];
  for (const [regionIndex, r] of source.regions.entries()) {
    const business = regionIndex % 2 === 0,
      expectedDimensions = business ? expectedBusiness : expectedReconciliation,
      captions = business ? businessCaptions : ["Corporate", "Reconciling Items", "Total"];
    demand(Number.isInteger(r.tableIndex) && r.tableIndex >= 0);
    if (regionIndex) demand(r.tableIndex > source.regions[regionIndex - 1].tableIndex);
    const rows = r.originalRows;
    demand(rows.length >= 5 && rows.length <= 9);
    rows.forEach((row, i) => equal(row.rowIndex, i));
    originalJpmMillionDollarRows(rows, units);
    const money = rows.filter((row) => row.cells.some((c) => c.fact));
    equal(money.length, 3);
    equalStructure(
      money.map((row) => row.cells[0].label),
      labels
    );
    // Original annotation cells are retained exactly, not interpreted as amounts.
    demand(
      money.every(
        (row) =>
          !row.cells[0].fact &&
          row.cells.slice(1).every((c) => c.fact || /^(?:\$|\)|\([befg]\))?$/.test(c.label))
      ),
      "Untagged original matrix monetary cell"
    );
    equalStructure(
      money.map((row) => row.rowIndex),
      Array.from({ length: 3 }, (_, i) => rows.length - 3 + i)
    );
    const headerRows = rows.filter((row) => !row.cells.some((c) => c.fact));
    const captionRow = headerRows.filter((row) =>
      row.cells.some((c) =>
        business ? tail(c.label) === "Consumer & Community Banking" : c.label === "Corporate"
      )
    );
    equal(captionRow.length, 1);
    const captionCells = captionRow[0].cells.filter(
      (c) => c.label && !c.label.startsWith("As of or for ")
    );
    equalStructure(
      captionCells.map((c) => tail(c.label)),
      captions
    );
    const periodCells = headerRows.flatMap((row) =>
      row.cells.filter((c) => c.label.startsWith("As of or for "))
    );
    equal(periodCells.length, 1);
    const duration = annual
      ? "year"
      : regionIndex < 2
        ? "three months"
        : quarter === 2
          ? "six months"
          : "nine months";
    equal(
      periodCells[0].label,
      `As of or for the ${duration} ended ${monthNames[dateTail]}, (in millions, except ratios)`
    );
    for (const row of headerRows)
      for (const c of row.cells)
        demand(
          !c.label ||
            /^20\d{2}$/.test(c.label) ||
            c === periodCells[0] ||
            captionCells.includes(c) ||
            [
              "(Table continued on next page)",
              "(Table continued from previous page)",
              "Segment results and reconciliation (a)",
              "Segment & Corporate results and reconciliation (a)"
            ].includes(c.label),
          "Unknown original matrix heading"
        );
    const yearRows = headerRows.filter((row) => row.cells.some((c) => /^20\d{2}$/.test(c.label)));
    equal(yearRows.length, 1);
    const years = yearRows[0].cells.filter((c) => /^20\d{2}$/.test(c.label)),
      yearCount = annual ? 3 : 2;
    equal(years.length, captions.length * yearCount);
    equalStructure(
      years.map((c) => Number(c.label)),
      captions.flatMap(() => Array.from({ length: yearCount }, (_, i) => sourceYear - i))
    );
    const cellsByRow = money.map((row) => row.cells.filter((c) => c.fact));
    cellsByRow.forEach((cells) => equal(cells.length, years.length));
    for (const [columnIndex, y] of years.entries()) {
      const captionIndex = Math.floor(columnIndex / yearCount),
        year = Number(y.label);
      const selected = cellsByRow.map((cells) => cells[columnIndex]);
      const values = [];
      for (const [i, c] of selected.entries()) {
        const f = c.fact!;
        equal(f.tag, tags[i]);
        equal(f.cik, "0000019617");
        equal(f.currency, "USD");
        equal(f.decimals, -6);
        demand(Number.isSafeInteger(f.value));
        equal(c.rowSpan, 1);
        demand(
          c.columnIndex >= y.columnIndex && c.columnIndex + c.span <= y.columnIndex + y.span,
          "Original exact year-cell containment"
        );
        equal(f.endDate, year + "-" + dateTail);
        equal(
          f.startDate,
          year +
            "-" +
            (annual || regionIndex >= 2 ? "01-01" : ["01-01", "04-01", "07-01"][quarter - 1])
        );
        equal(
          canonical(f.dimensions),
          canonical(expectedDimensions[captionIndex]),
          "Original caption/dimension identity mismatch"
        );
        // Dollar-sign and parenthesis cells have different original spans by row;
        // each amount must remain inside its own unchanged literal year band.
        values.push(f.value);
        allFactCells.push({
          table: r.tableIndex,
          row: money[i].rowIndex,
          column: c.columnIndex,
          fact: f
        });
      }
      equal(
        BigInt(values[0]) + BigInt(values[1]),
        BigInt(values[2]),
        "Original matrix revenue triplet"
      );
      if (business)
        demand(
          values[2] >= 0,
          "Business revenue cannot be projected as a negative business branch"
        );
      const key = selected[0].fact!.startDate + "|" + selected[0].fact!.endDate,
        groups = scopeGroups.get(key) ?? [];
      demand(
        !groups.some((g) => canonical(g.dimensions) === canonical(selected[0].fact!.dimensions)),
        "Duplicate complete original matrix group"
      );
      groups.push({
        dimensions: selected[0].fact!.dimensions,
        values,
        table: r.tableIndex,
        caption: tail(captionCells[captionIndex].label),
        revenueCell: selected[2],
        revenueRow: money[2].rowIndex
      });
      scopeGroups.set(key, groups);
    }
  }
  const primaryRows = primary.originalRows,
    primaryYears = primaryRows.filter((row) => row.cells.some((c) => /^20\d{2}$/.test(c.label)));
  primaryRows.forEach((row, i) => equal(row.rowIndex, i));
  equal(primaryYears.length, 1);
  demand(primary.tableIndex < source.regions[0].tableIndex);
  demand(primaryRows.some((row) => row.cells[0].label === "Revenue"));
  equal(primaryRows.at(-1)?.cells[0].label, "Total net revenue");
  const primaryMoney = primaryRows.filter((row) => row.cells.some((c) => c.fact));
  const splitFees = sourceYear >= 2023;
  const primaryExpected = [
    ["Investment banking fees", "us-gaap:InvestmentBankingRevenue"],
    ["Principal transactions", "us-gaap:PrincipalTransactionsRevenue"],
    ["Lending- and deposit-related fees", "jpm:LendingAndDepositRelatedFees"],
    ...(splitFees
      ? [
          ["Asset management fees", "jpm:AssetManagementFees"],
          ["Commissions and other fees", "jpm:FeesAndCommissions1"]
        ]
      : [
          [
            "Asset management, administration and commissions",
            "jpm:AssetManagementAdministrationAndCommissions"
          ]
        ]),
    ["Investment securities", "us-gaap:DebtSecuritiesAvailableForSaleRealizedGainLoss"],
    ["Mortgage fees and related income", "jpm:MortgageFeesAndRelatedIncome"],
    ["Card income", "jpm:FeesAndCommissionsCreditAndDebitCards1"],
    ["Other income", "us-gaap:NoninterestIncomeOther"],
    ["Noninterest revenue", "us-gaap:NoninterestIncome"],
    ["Interest income", "us-gaap:InterestIncomeOperating"],
    [
      "Interest expense",
      filing.reportDate >= "2024-06-30"
        ? "us-gaap:InterestExpenseOperating"
        : "us-gaap:InterestExpense"
    ],
    ["Net interest income", "us-gaap:InterestIncomeExpenseNet"],
    ["Total net revenue", "us-gaap:RevenuesNetOfInterestExpense"]
  ];
  equal(primaryMoney.length, primaryExpected.length);
  for (const [i, row] of primaryMoney.entries()) {
    const label = tail(row.cells[0].label),
      expected = primaryExpected[i];
    demand(
      expected[0] === "Investment securities"
        ? [
            "Investment securities gains",
            "Investment securities losses",
            "Investment securities gains/(losses)"
          ].includes(label)
        : label === expected[0],
      "Unknown complete original primary label"
    );
    demand(
      row.cells.slice(1).every((c) => c.fact || /^(?:\$|\))?$/.test(c.label)),
      "Untagged original monetary primary cell"
    );
    demand(
      row.cells.filter((c) => c.fact).every((c) => c.fact!.tag === expected[1]),
      "Original primary label/concept changed"
    );
  }
  const primaryByScope = new Map<string, Map<string, number>>();
  for (const row of primaryMoney)
    for (const c of row.cells) {
      if (!c.fact) continue;
      const f = c.fact;
      equal(f.cik, "0000019617");
      equalStructure(f.dimensions, {});
      equal(f.currency, "USD");
      equal(f.decimals, -6);
      demand(Number.isSafeInteger(f.value));
      const yearCells = primaryYears[0].cells.filter(
        (y) =>
          /^20\d{2}$/.test(y.label) &&
          c.columnIndex >= y.columnIndex &&
          c.columnIndex + c.span <= y.columnIndex + y.span
      );
      equal(yearCells.length, 1);
      equal(Number(yearCells[0].label), Number(f.endDate.slice(0, 4)));
      const key = f.startDate + "|" + f.endDate,
        group = primaryByScope.get(key) ?? new Map();
      demand(!group.has(f.tag));
      group.set(f.tag, f.value);
      primaryByScope.set(key, group);
    }
  equal(primaryByScope.size, scopeGroups.size);
  const scopes = [];
  for (const [dates, groups] of scopeGroups) {
    equalStructure(
      groups.map((g) => canonical(g.dimensions)),
      [...expectedBusiness, ...expectedReconciliation].map(canonical)
    );
    const nd = groups.at(-1)!;
    for (let i = 0; i < 3; i++)
      equal(
        groups.slice(0, -1).reduce((sum, g) => sum + BigInt(g.values[i]), 0n),
        BigInt(nd.values[i])
      );
    const primaryFacts = primaryByScope.get(dates);
    demand(primaryFacts);
    equalStructure(
      tags.map((tag) => primaryFacts.get(tag)),
      nd.values,
      "Independent original primary net-revenue triplet"
    );
    const noninterestTags = primaryExpected.slice(0, splitFees ? 9 : 8).map((r) => r[1]);
    equal(
      noninterestTags.reduce((sum, tag) => sum + BigInt(primaryFacts.get(tag)!), 0n),
      BigInt(primaryFacts.get(tags[0])!),
      "Complete original primary noninterest components"
    );
    equal(
      BigInt(primaryFacts.get("us-gaap:InterestIncomeOperating")!) -
        BigInt(primaryFacts.get(primaryExpected.at(-3)![1])!),
      BigInt(primaryFacts.get(tags[1])!),
      "Original primary interest expense deduction"
    );
    scopes.push({
      dates,
      business: groups.slice(0, expectedBusiness.length),
      corporate: groups.at(-3),
      reconciliation: groups.at(-2),
      consolidated: nd,
      primaryTable: primary.tableIndex
    });
  }
  return {
    scopes,
    originalMonetaryCells: allFactCells.length,
    primaryTable: primary.tableIndex,
    sourceYear,
    merged,
    scope:
      "Original complete business, Corporate and reconciling revenue matrices with independent primary noninterest and net-interest ledgers."
  };
}
