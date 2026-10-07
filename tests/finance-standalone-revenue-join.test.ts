import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayOriginalStandaloneSourceProof } from "../src/features/finance/standalone-source-proof";
import {
  originalStandaloneBusinessSelections,
  originalStandaloneBusinessSegments,
  originalStandaloneBusinessBasis,
  originalStandaloneBusinessProblem,
  type OriginalStandaloneBusinessProof
} from "../src/features/finance/standalone-business";
import { businessPeriod, flowPeriod } from "../scripts/finance/v2-model";
import { readOriginalStandaloneBusinessFiling } from "../scripts/finance/standalone-business-v2";
import type { CompanyV2, PeriodV2 } from "../src/features/finance/v2-types";
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
        rows: [
          { rowIndex: 3, label: "Net sales", columns: ranges, tag, dimensions: {} },
          {
            rowIndex: 16,
            label: "Provision for income taxes",
            columns: ranges,
            tag: "us-gaap:IncomeTaxExpenseBenefit",
            dimensions: {}
          }
        ]
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

describe("standalone evidence replay and issuer business proof", () => {
  const make = () => {
    const selections = originalStandaloneBusinessSelections(source.cik, 2018, 2016, 1, 2);
    const joined = joinOriginalStandaloneRevenueRows(source, selections);
    const proof: OriginalStandaloneBusinessProof = {
      ruleId: "alb-original-separate-revenue-v1",
      reportDate: "2018-12-31",
      form: "10-K",
      source: joined.proof
    };
    const p: PeriodV2 = {
      id: "FY2016",
      label: "FY 2016",
      kind: "annual",
      fiscalYear: 2016,
      startDate: "2016-01-01",
      endDate: "2016-12-31",
      filedAt: "2019-02-27",
      accession: source.accession,
      sourceUrl: source.primaryUrl,
      reportingCurrency: "USD",
      displayCurrency: "USD",
      derived: true,
      metrics: { revenue: 2677203000, incomeTax: 96263000 },
      metricSources: {
        revenue: {
          label: "Revenues",
          tag: "us-gaap:Revenues",
          sourceUrl: source.primaryUrl,
          accession: source.accession,
          filedAt: "2019-02-27",
          method: "reported"
        }
      },
      coverage: { basics: true, segments: true, sankey: false }
    };
    p.segments = originalStandaloneBusinessSegments(p, proof);
    p.segmentSourceUrl = p.sourceUrl;
    p.segmentBasis = originalStandaloneBusinessBasis(proof.ruleId);
    p.businessBreakdownSource = {
      method: "reviewed-original-standalone-revenue",
      standaloneRevenue: proof,
      ruleId: proof.ruleId,
      tableIndex: 2,
      totalTableIndex: 1,
      sourceUrl: p.sourceUrl,
      accession: p.accession!,
      revenueTag: "us-gaap:Revenues",
      revenue: p.metrics.revenue!,
      revenueDecimals: -3,
      totalLabel: "Total net sales",
      omittedSubtotals: []
    };
    return { joined, proof, p };
  };
  it("re-decodes original declarations after JSON storage without trusting parsed amount copies", () => {
    const { proof, p } = make();
    const saved = JSON.parse(JSON.stringify(proof.source));
    const replay = replayOriginalStandaloneSourceProof(saved);
    expect(replay.joins[1].monetaryRows.map((r) => r.originalFact.value)).toEqual([
      668852000, 792425000, 1031501000, 180988000, 3437000, 2677203000
    ]);
    expect(saved).not.toHaveProperty("facts");
    expect(originalStandaloneBusinessProblem(JSON.parse(JSON.stringify(p)))).toBeUndefined();
    expect(businessPeriod(p)?.segments?.map((s) => s.label)).toEqual([
      "Lithium",
      "Bromine Specialties",
      "Catalysts",
      "All Other",
      "Corporate"
    ]);
    expect(
      p.segments?.every((s) => s.grossProfit === undefined && s.grossProfitSource === undefined)
    ).toBe(true);
  });
  it("imports all five original Albemarle business categories without filling missing profit-flow items", async () => {
    const { p } = make();
    delete p.segments;
    delete p.segmentBasis;
    delete p.segmentSourceUrl;
    delete p.businessBreakdownSource;
    p.coverage = { basics: true, segments: false, sankey: false };
    const next = await readOriginalStandaloneBusinessFiling(
      source.primaryHtml,
      source.instanceXml,
      source.instanceUrl,
      {
        ticker: "ALB",
        name: "Albemarle Corporation",
        cik: source.cik,
        sector: "Materials",
        universe: "sp500"
      },
      {
        accession: source.accession,
        filedAt: p.filedAt,
        reportDate: "2018-12-31",
        form: "10-K",
        primaryDocument: "a1231201810-kdocument.htm",
        sourceUrl: source.primaryUrl,
        directoryUrl: "https://www.sec.gov/Archives/edgar/data/915913/000091591319000021/"
      },
      undefined,
      [p]
    );
    expect(next).toHaveLength(1);
    expect(next[0].segments?.map((s) => s.revenue)).toEqual([
      668852000, 792425000, 1031501000, 180988000, 3437000
    ]);
    expect(next[0].metrics).toEqual(p.metrics);
    expect(next[0].coverage).toEqual({ basics: true, segments: true, sankey: false });
    expect(flowPeriod(next[0])).toBeUndefined();
    expect(p.segments).toBeUndefined();
  });
  it.each([
    [
      "altered original monetary lexical",
      (p: PeriodV2) => {
        const x = p.businessBreakdownSource!.standaloneRevenue!.source.originalXml;
        x.declarations = x.declarations.map((s) => s.replace(">2677203000<", ">2677203001<"));
      }
    ],
    [
      "altered original year context",
      (p: PeriodV2) => {
        const x = p.businessBreakdownSource!.standaloneRevenue!.source.originalXml;
        x.contexts = x.contexts.map((s) => s.replace("2016-01-01", "2015-01-01"));
      }
    ],
    [
      "altered original units",
      (p: PeriodV2) => {
        const x = p.businessBreakdownSource!.standaloneRevenue!.source.originalXml;
        x.units = x.units.map((s) => s.replace("iso4217:USD", "iso4217:CAD"));
      }
    ],
    [
      "changed original business namespace",
      (p: PeriodV2) => {
        const x = p.businessBreakdownSource!.standaloneRevenue!.source.originalXml;
        x.root = x.root.replace("http://www.albemarle.com/20181231", "https://example.invalid/alb");
      }
    ],
    [
      "synthetic inline cell",
      (p: PeriodV2) => {
        const t = p.businessBreakdownSource!.standaloneRevenue!.source.tables[1];
        t.rows[6].cells[0].fact = {} as NonNullable<(typeof t.rows)[6]["cells"][0]["fact"]>;
      }
    ],
    [
      "omitted original physical row",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.standaloneRevenue!.source.tables[1].rows.splice(5, 1);
      }
    ],
    [
      "altered business scope",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.standaloneRevenue!.source.tables[1].selection.rows[0].dimensions =
          {};
      }
    ],
    [
      "altered fiscal metadata",
      (p: PeriodV2) => {
        const x = p.businessBreakdownSource!.standaloneRevenue!.source.originalXml;
        x.metadata = x.metadata.map((s) => s.replace(">2018<", ">2016<"));
      }
    ],
    [
      "altered original report date",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.standaloneRevenue!.reportDate = "2017-12-31";
      }
    ],
    [
      "changed visible monetary value",
      (p: PeriodV2) => {
        const t = p.businessBreakdownSource!.standaloneRevenue!.source.tables[1];
        t.rows[6].cells.find((c) => c.label === "668,852")!.label = "668,853";
      }
    ],
    [
      "renamed original business",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.standaloneRevenue!.source.tables[1].rows[6].cells[0].label =
          "New business";
      }
    ],
    [
      "altered segment amount",
      (p: PeriodV2) => {
        p.segments![0].revenue++;
      }
    ],
    [
      "different proof method",
      (p: PeriodV2) => {
        p.businessBreakdownSource!.method = "statement-revenue-rows";
      }
    ],
    [
      "foreign instance accession",
      (p: PeriodV2) => {
        const s = p.businessBreakdownSource!.standaloneRevenue!.source;
        s.instanceSource.url = s.instanceSource.url.replace(
          "000091591319000021",
          "000091591319000022"
        );
      }
    ]
  ])("withholds %s when reading stored charts", (_label, mutate) => {
    const { p } = make();
    mutate(p);
    expect(originalStandaloneBusinessProblem(p)).toBeDefined();
    expect(businessPeriod(p)).toBeUndefined();
  });
  it("withholds a locally rebound original context namespace", () => {
    const { proof } = make();
    const x = proof.source.originalXml;
    x.contexts[0] = x.contexts[0].replace(
      /<xbrli:context /,
      '<xbrli:context xmlns:us-gaap="https://example.invalid/" '
    );
    expect(() => replayOriginalStandaloneSourceProof(proof.source)).toThrow(/namespace/);
  });
});

describe("original standalone AMETEK business import", () => {
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
  const makePeriod = (): PeriodV2 => {
    const filedAt = "2019-02-21",
      metrics = {
        revenue: 3840087000,
        costOfRevenue: 2585499000,
        totalOperatingCosts: 3049108000,
        operatingIncome: 790979000,
        pretaxIncome: 693103000,
        incomeTax: 180945000,
        netIncome: 512158000
      };
    const tags = {
      revenue: "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      costOfRevenue: "us-gaap:CostOfGoodsAndServicesSold",
      totalOperatingCosts: "us-gaap:CostsAndExpenses",
      operatingIncome: "us-gaap:OperatingIncomeLoss",
      pretaxIncome:
        "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      incomeTax: "us-gaap:IncomeTaxExpenseBenefit",
      netIncome: "us-gaap:NetIncomeLoss"
    };
    return {
      id: "FY2016",
      label: "FY 2016",
      kind: "annual",
      fiscalYear: 2016,
      startDate: "2016-01-01",
      endDate: "2016-12-31",
      filedAt,
      accession: ame.accession,
      sourceUrl: ame.primaryUrl,
      reportingCurrency: "USD",
      displayCurrency: "USD",
      derived: false,
      metrics,
      metricSources: Object.fromEntries(
        Object.entries(tags).map(([key, tag]) => [
          key,
          {
            label: key,
            tag,
            sourceUrl: ame.primaryUrl,
            accession: ame.accession,
            filedAt,
            method: "reported"
          }
        ])
      ),
      coverage: { basics: true, segments: false, sankey: true }
    };
  };
  it("validates complete closing EIG/EMG revenue with original independent primary tax and total", () => {
    const p = makePeriod(),
      joined = joinOriginalStandaloneRevenueRows(
        ame,
        originalStandaloneBusinessSelections(ame.cik, 2018, 2016, 0, 1)
      );
    const proof: OriginalStandaloneBusinessProof = {
      ruleId: "ame-original-separate-closing-sales-v1",
      reportDate: "2018-12-31",
      form: "10-K",
      source: joined.proof
    };
    expect(originalStandaloneBusinessSegments(p, proof).map((s) => s.revenue)).toEqual([
      2360281000, 1479806000
    ]);
    expect(originalStandaloneBusinessBasis(proof.ruleId)).toContain("MD&A");
    expect(
      replayOriginalStandaloneSourceProof(
        JSON.parse(JSON.stringify(joined.proof))
      ).joins[0].monetaryRows.map((r) => r.originalFact.value)
    ).toEqual([3840087000, 180945000]);
  });
  it("reads an actual standalone filing through the shared importer without altering prior financial metrics", async () => {
    const p = makePeriod(),
      prior = JSON.stringify([
        p.metrics,
        p.metricSources,
        p.startDate,
        p.endDate,
        p.filedAt,
        p.sourceUrl,
        p.derived
      ]);
    const identity = {
      ticker: "AME",
      name: "AMETEK, Inc.",
      cik: ame.cik,
      sector: "Industrials",
      universe: "sp500" as const
    };
    const filing = {
      accession: ame.accession,
      filedAt: p.filedAt,
      reportDate: "2018-12-31",
      form: "10-K",
      primaryDocument: "d640432d10k.htm",
      sourceUrl: ame.primaryUrl,
      directoryUrl: "https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/"
    };
    const result = await readOriginalStandaloneBusinessFiling(
      ame.primaryHtml,
      ame.instanceXml,
      ame.instanceUrl,
      identity,
      filing,
      undefined,
      [p]
    );
    expect(result).toHaveLength(1);
    const next = result[0];
    expect(next.coverage).toEqual({ basics: true, segments: true, sankey: true });
    expect(next.segments?.map((s) => s.revenue)).toEqual([2360281000, 1479806000]);
    expect(businessPeriod(next)).toBeDefined();
    expect(flowPeriod(next)).toBeDefined();
    expect(
      JSON.stringify([
        next.metrics,
        next.metricSources,
        next.startDate,
        next.endDate,
        next.filedAt,
        next.sourceUrl,
        next.derived
      ])
    ).toBe(prior);
    expect(originalStandaloneBusinessProblem(JSON.parse(JSON.stringify(next)))).toBeUndefined();
    expect(p.coverage.segments).toBe(false);
    expect(p.segments).toBeUndefined();
  });
  it("preserves richer same-filing statements when Company Facts supplies a shorter candidate", async () => {
    const p = makePeriod();
    const basic: PeriodV2 = {
      ...p,
      metrics: { revenue: p.metrics.revenue, incomeTax: p.metrics.incomeTax },
      coverage: { basics: true, segments: false, sankey: false }
    };
    const base: CompanyV2 = {
      schemaVersion: 2,
      ticker: "AME",
      name: "AMETEK, Inc.",
      cik: ame.cik,
      accent: "#337d9f",
      reportingCurrency: "USD",
      latestPeriod: p.label,
      dataStatus: "verified",
      version: "fixture",
      updatedAt: "2026-10-06T00:00:00Z",
      warnings: [],
      annual: [p],
      quarterly: []
    };
    const result = await readOriginalStandaloneBusinessFiling(
      ame.primaryHtml,
      ame.instanceXml,
      ame.instanceUrl,
      {
        ticker: "AME",
        name: "AMETEK, Inc.",
        cik: ame.cik,
        sector: "Industrials",
        universe: "sp500"
      },
      {
        accession: ame.accession,
        filedAt: p.filedAt,
        reportDate: "2018-12-31",
        form: "10-K",
        primaryDocument: "d640432d10k.htm",
        sourceUrl: ame.primaryUrl,
        directoryUrl: "https://www.sec.gov/Archives/edgar/data/1037868/000119312519046947/"
      },
      base,
      [basic]
    );
    expect(result).toHaveLength(1);
    expect(result[0].metrics).toEqual(p.metrics);
    expect(result[0].metricSources).toEqual(p.metricSources);
    expect(result[0].coverage).toEqual({ basics: true, segments: true, sankey: true });
    expect(base.annual[0].coverage.segments).toBe(false);
  });
});
