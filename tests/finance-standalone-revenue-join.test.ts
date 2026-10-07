import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  joinOriginalStandaloneRevenueRows,
  OriginalStandaloneRevenueJoinError,
  type OriginalStandaloneSource,
  type OriginalStandaloneTableSelection
} from "../scripts/finance/standalone-revenue-join";
const read = (name: string) =>
  readFileSync(new URL(`./fixtures/finance/${name}`, import.meta.url), "utf8");
const source: OriginalStandaloneSource = {
  cik: "0000915913",
  accession: "0000915913-19-000021",
  primaryUrl:
    "https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/a1231201810-kdocument.htm",
  primaryHtml: read("alb-fy2016-original-separate-income-business.html"),
  instanceUrl: "https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/alb-20181231.xml",
  instanceXml: read("alb-fy2016-original-separate-xbrl.xml")
};
const columns = [
  { columnIndex: 1, span: 3 },
  { columnIndex: 5, span: 3 },
  { columnIndex: 9, span: 3 }
];
const period = { startDate: "2016-01-01", endDate: "2016-12-31" };
const primary: OriginalStandaloneTableSelection = {
  tableIndex: 1,
  calendarYear: 2016,
  period,
  units: { rowIndex: 2, label: "(In Thousands, Except Per Share Amounts)" },
  headers: {
    rowIndex: 3,
    labels: ["2018", "2017", "2016"],
    prefixLabel: "Year Ended December 31",
    selectedIndex: 2
  },
  rows: [
    [4, "Net sales", "us-gaap:Revenues", "same"],
    [5, "Cost of goods sold", "us-gaap:CostOfRevenue", "same"],
    [6, "Gross profit", "us-gaap:GrossProfit", "same"],
    [
      7,
      "Selling, general and administrative expenses",
      "us-gaap:SellingGeneralAndAdministrativeExpense",
      "same"
    ],
    [8, "Research and development expenses", "us-gaap:ResearchAndDevelopmentExpense", "same"],
    [9, "Gain on sales of businesses, net", "us-gaap:GainLossOnSaleOfBusiness", "opposite"],
    [
      10,
      "Acquisition and integration related costs",
      "us-gaap:BusinessCombinationAcquisitionRelatedCosts",
      "same"
    ],
    [11, "Operating profit", "us-gaap:OperatingIncomeLoss", "same"],
    [12, "Interest and financing expenses", "us-gaap:InterestAndDebtExpense", "opposite"],
    [13, "Other expenses, net", "us-gaap:OtherNonoperatingIncomeExpense", "same"],
    [
      14,
      "Income from continuing operations before income taxes and equity in net income of unconsolidated investments",
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      "same"
    ],
    [15, "Income tax expense", "us-gaap:IncomeTaxExpenseBenefit", "same"],
    [
      16,
      "Income from continuing operations before equity in net income of unconsolidated investments",
      "alb:IncomeBeforeEquityInNetIncomeOfUnconsolidatedInvestments",
      "same"
    ],
    [
      17,
      "Equity in net income of unconsolidated investments (net of tax)",
      "us-gaap:IncomeLossFromEquityMethodInvestments",
      "same"
    ],
    [
      18,
      "Net income from continuing operations",
      "us-gaap:IncomeLossFromContinuingOperationsIncludingPortionAttributableToNoncontrollingInterest",
      "same"
    ],
    [
      19,
      "Income from discontinued operations (net of tax)",
      "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTax",
      "same"
    ],
    [20, "Net income", "us-gaap:ProfitLoss", "same"],
    [
      21,
      "Net income attributable to noncontrolling interests",
      "us-gaap:NetIncomeLossAttributableToNoncontrollingInterest",
      "opposite"
    ],
    [22, "Net income attributable to Albemarle Corporation", "us-gaap:NetIncomeLoss", "same"]
  ].map(([rowIndex, label, tag, polarity]) => ({
    rowIndex: Number(rowIndex),
    label: String(label),
    tag: String(tag),
    columns,
    dimensions: {},
    displayPolarity: polarity as "same" | "opposite"
  }))
};
const businesses: OriginalStandaloneTableSelection = {
  tableIndex: 2,
  calendarYear: 2016,
  period,
  units: { rowIndex: 4, label: "(In thousands)" },
  headers: { rowIndex: 3, labels: ["2018", "2017", "2016"], selectedIndex: 2 },
  rows: [
    "Lithium",
    "Bromine Specialties",
    "Catalysts",
    "All Other",
    "Corporate",
    "Total net sales"
  ].map<OriginalStandaloneTableSelection["rows"][number]>((label, i) => ({
    rowIndex: 6 + i,
    label,
    columns,
    tag: "us-gaap:Revenues",
    dimensions: (i < 3
      ? {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": `alb:${["Lithium", "BromineSpecialties", "Catalysts"][i]}Member`
        }
      : i === 3
        ? { "srt:ConsolidationItemsAxis": "us-gaap:MaterialReconcilingItemsMember" }
        : i === 4
          ? { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" }
          : {}) as Record<string, string>
  }))
};
describe("original separate XML and physical annual revenue joins", () => {
  it("joins all five original Albemarle branches and independently reported total", () => {
    const p = joinOriginalStandaloneRevenueRows(source, [primary, businesses]);
    expect(p.joins[1].monetaryRows.map((r) => r.originalFact.value)).toEqual([
      668852000, 792425000, 1031501000, 180988000, 3437000, 2677203000
    ]);
    expect(p.joins[0].monetaryRows[0].originalFact.value).toBe(2677203000);
    expect(p.joins[0].monetaryRows.map((r) => r.originalFact.value)).toEqual([
      2677203000, 1706897000, 970306000, 353765000, 80475000, 122298000, 57384000, 600980000,
      65181000, -20535000, 515264000, 96263000, 419001000, 59637000, 478638000, 202131000,
      680769000, 37094000, 643675000
    ]);
    expect(p.joins[1].monetaryRows.slice(0, 5).reduce((s, r) => s + r.originalFact.value, 0)).toBe(
      2677203000
    );
    expect(
      p.joins.flatMap((t) => t.rows.flatMap((r) => r.cells)).every((c) => c.fact === undefined)
    ).toBe(true);
    expect(p.instanceSource.url).toBe(source.instanceUrl);
    expect(p.primarySource.url).toBe(source.primaryUrl);
  });
  it("preserves a subtracted positive gain and a negative nonoperating fact separately", () => {
    const p = joinOriginalStandaloneRevenueRows(source, [primary]);
    const gain = p.joins[0].monetaryRows.find(
        (r) => r.originalFact.tag === "us-gaap:GainLossOnSaleOfBusiness"
      )!,
      expense = p.joins[0].monetaryRows.find(
        (r) => r.originalFact.tag === "us-gaap:OtherNonoperatingIncomeExpense"
      )!;
    expect(gain.displayLexical).toBe("(122,298)");
    expect(gain.displayedWholeDollarValue).toBe(-122298000);
    expect(gain.originalFact.value).toBe(122298000);
    expect(expense.originalFact.value).toBe(-20535000);
    expect(expense.displayedWholeDollarValue).toBe(-20535000);
    expect(p.joins[0].rows.find((r) => r.rowIndex === 9)?.cells.some((c) => c.label === "—")).toBe(
      true
    );
  });
  it("joins original AMETEK business columns despite different physical year-header spacers", () => {
    const ame: OriginalStandaloneSource = {
      cik: "0001037868",
      accession: "0001193125-19-046947",
      primaryUrl:
        "https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/d640432d10k.htm",
      primaryHtml: read("ame-fy2016-original-separate-income-business.html"),
      instanceUrl:
        "https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/ame-20181231.xml",
      instanceXml: read("ame-original-standalone.xml")
    };
    const ranges = [
      { columnIndex: 2, span: 3 },
      { columnIndex: 6, span: 3 },
      { columnIndex: 10, span: 3 }
    ];
    const tag = "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax";
    const p = joinOriginalStandaloneRevenueRows(ame, [
      {
        tableIndex: 0,
        calendarYear: 2016,
        period,
        units: {
          precedingTextSuffix:
            "Consolidated Statement of Income (In thousands, except per share amounts)"
        },
        headers: { rowIndex: 2, labels: ["2018", "2017", "2016"], selectedIndex: 2 },
        rows: [{ rowIndex: 3, label: "Net sales", columns: ranges, tag, dimensions: {} }]
      },
      {
        tableIndex: 1,
        calendarYear: 2016,
        period,
        units: { rowIndex: 3, label: "(In thousands)" },
        yearHeader: { rowIndex: 1, label: "2016" },
        headers: { rowIndex: 2, labels: ["EIG", "EMG", "Total"], selectedIndex: 0 },
        rows: [0, 1, 2].map<OriginalStandaloneTableSelection["rows"][number]>((i) => ({
          rowIndex: 22,
          label: "Consolidated net sales",
          columns: ranges,
          selectedColumn: i,
          tag,
          dimensions: (i < 2
            ? {
                "us-gaap:StatementBusinessSegmentsAxis": `ame:${["ElectronicInstrumentsGroup", "ElectromechanicalGroup"][i]}Member`
              }
            : {}) as Record<string, string>
        }))
      }
    ]);
    expect(p.joins[1].monetaryRows.map((r) => r.originalFact.value)).toEqual([
      2360281000, 1479806000, 3840087000
    ]);
    expect(p.joins[0].monetaryRows[0].originalFact.value).toBe(3840087000);
    expect(p.originalMetadata.find((m) => m.tag === "dei:DocumentFiscalYearFocus")?.lexical).toBe(
      "2018"
    );
  });
  it.each([
    [
      "changed visible amount",
      (s: OriginalStandaloneSource) => ({
        ...s,
        primaryHtml: s.primaryHtml.replace("2,677,203", "2,677,204")
      })
    ],
    [
      "changed original units",
      (s: OriginalStandaloneSource) => ({
        ...s,
        primaryHtml: s.primaryHtml.replace(
          "(In Thousands, Except Per Share Amounts)",
          "(In millions)"
        )
      })
    ],
    [
      "changed visible year",
      (s: OriginalStandaloneSource) => ({
        ...s,
        primaryHtml: s.primaryHtml.replace(/>2016</g, ">2015<")
      })
    ],
    [
      "foreign accession",
      (s: OriginalStandaloneSource) => ({
        ...s,
        instanceUrl: s.instanceUrl.replace("000091591319000021", "000091591319000022")
      })
    ],
    [
      "foreign issuer",
      (s: OriginalStandaloneSource) => ({
        ...s,
        primaryUrl: s.primaryUrl.replace("/915913/", "/1037868/")
      })
    ],
    [
      "synthetic inline markup",
      (s: OriginalStandaloneSource) => ({ ...s, primaryHtml: s.primaryHtml + "<ix:nonFraction>" })
    ]
  ])("withholds %s", (_name, mutate) =>
    expect(() => joinOriginalStandaloneRevenueRows(mutate(source), [primary])).toThrow(
      OriginalStandaloneRevenueJoinError
    )
  );
  it("does not accept an equal-value declaration at a different business scope", () => {
    const p = structuredClone(primary);
    p.rows[0].dimensions = { "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember" };
    expect(() => joinOriginalStandaloneRevenueRows(source, [p])).toThrow(/scoped XML/);
  });
  it("does not use equal values to select conflicting original precision copies", () => {
    const f = source.instanceXml.match(
      /<us-gaap:Revenues\s[^>]*contextRef="FD2016Q4YTD"[^>]*>[\s\S]*?<\/us-gaap:Revenues>/
    )![0];
    const xml = source.instanceXml.replace(
      "</xbrli:xbrl>",
      f.replace('decimals="-3"', 'decimals="-6"') + "</xbrli:xbrl>"
    );
    expect(() =>
      joinOriginalStandaloneRevenueRows({ ...source, instanceXml: xml }, [primary])
    ).toThrow(/ambiguous/);
  });
  it("retains a selected missing dash without substituting zero", () => {
    const s = { ...source, primaryHtml: source.primaryHtml.replace("2,677,203", "—") };
    expect(() => joinOriginalStandaloneRevenueRows(s, [primary])).toThrow(/no disclosed amount/);
  });
  it("withholds the wrong year column instead of selecting by matching XML amounts", () => {
    const p = structuredClone(primary);
    p.headers.selectedIndex = 1;
    expect(() => joinOriginalStandaloneRevenueRows(source, [p])).toThrow(/year column/);
  });
  it("requires the explicit display-sign relation for an original positive gain", () => {
    const p = structuredClone(primary);
    p.rows.find((r) => r.tag === "us-gaap:GainLossOnSaleOfBusiness")!.displayPolarity = "same";
    expect(() => joinOriginalStandaloneRevenueRows(source, [p])).toThrow(/sign or precision/);
  });
  it("withholds unaccounted numeric cells and changed original row labels", () => {
    const p = structuredClone(primary);
    p.rows[0].columns[2].span = 1;
    expect(() => joinOriginalStandaloneRevenueRows(source, [p])).toThrow();
    const q = structuredClone(primary);
    q.rows[0].label = "Total revenues";
    expect(() => joinOriginalStandaloneRevenueRows(source, [q])).toThrow(/row or column/);
  });
});
