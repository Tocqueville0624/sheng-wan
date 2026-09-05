import { describe, expect, it } from "vitest";
import { parseInlineXbrl, extractInlinePeriods } from "../scripts/finance/ixbrl";
import { companies } from "../scripts/finance/companies";
import { assertSecUrl } from "../scripts/finance/sec-client";
import { assertPublishableManifest, validatePeriod } from "../scripts/finance/validate";
import { averageRate, parseH10TaiwanDollar } from "../scripts/finance/fed";
import snapshot from "../src/data/generated/finance.json";
import type { FinanceManifest } from "../src/features/finance/types";
import type { FilingAdapter } from "../scripts/finance/adapters";
const crawled = snapshot as FinanceManifest;

// A deliberately tiny synthetic parser fixture, never a published finance dataset.
const context = (id: string, dimensions = "") =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier>0000320193</xbrli:identifier>${dimensions ? `<xbrli:segment>${dimensions}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>`;
const fact = (tag: string, value: string, ctx = "total", attrs = "") =>
  `<ix:nonFraction name="${tag}" contextRef="${ctx}" unitRef="usd" scale="6" decimals="-6" ${attrs}>${value}</ix:nonFraction>`;
const fixture = (extra = "") =>
  `<html><ix:header><ix:resources>${context("total")}${context("business", '<xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">example:BusinessMember</xbrldi:explicitMember>')}<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit></ix:resources></ix:header><ix:nonNumeric name="dei:DocumentFiscalYearFocus">2025</ix:nonNumeric><ix:nonNumeric name="dei:DocumentFiscalPeriodFocus">FY</ix:nonNumeric><ix:nonNumeric name="dei:DocumentPeriodEndDate">December&#160;31, 2025</ix:nonNumeric>${fact("us-gaap:Revenues", "100")}${fact("us-gaap:Revenues", "100", "business")}${fact("us-gaap:CostOfRevenue", "60")}${fact("us-gaap:OperatingIncomeLoss", "20")}${fact("us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "18")}${fact("us-gaap:IncomeTaxExpenseBenefit", "3")}${fact("us-gaap:NetIncomeLoss", "15")}${extra}</html>`;
const adapter: FilingAdapter = {
  ticker: "AAPL",
  annualUrls: [],
  segmentBasis: "Fixture category",
  metricTags: { revenue: ["us-gaap:Revenues"] },
  segments: [
    {
      id: "business",
      label: "Business",
      tag: "us-gaap:Revenues",
      dimensions: { "srt:ProductOrServiceAxis": "example:BusinessMember" }
    }
  ]
};
const apple = companies.find((company) => company.ticker === "AAPL")!;
const extract = (html: string) =>
  extractInlinePeriods(
    parseInlineXbrl(html),
    apple,
    adapter,
    "https://www.sec.gov/Archives/example.htm",
    "2026-02-01"
  );

describe("SEC inline-XBRL parsing", () => {
  it("preserves nested date tags and ordered year text from actual Apple markup", () => {
    const html = fixture().replace(
      "December&#160;31, 2025",
      '<ix:nonNumeric name="dei:CurrentFiscalYearEndDate">December&#160;31</ix:nonNumeric>, 2025'
    );
    expect(parseInlineXbrl(html).periodEnd).toBe("2025-12-31");
    expect(extract(html)[0].fiscalYear).toBe(2025);
  });

  it("retains inner monetary facts and does not swallow following facts after a self-closing nil", () => {
    const extra =
      '<ix:nonFraction name="example:Absent" xsi:nil="true" contextRef="total" unitRef="usd" />' +
      '<ix:nonFraction name="example:Outer" contextRef="total" unitRef="usd">' +
      fact("example:Inner", "9") +
      "</ix:nonFraction>" +
      fact("example:Following", "8");
    const parsed = parseInlineXbrl(fixture(extra));
    expect(parsed.facts.find((f) => f.tag === "example:Inner")?.value).toBe(9000000);
    expect(parsed.facts.find((f) => f.tag === "example:Following")?.value).toBe(8000000);
    expect(parsed.facts.some((f) => f.tag === "example:Absent" || f.tag === "example:Outer")).toBe(
      false
    );
  });

  it("refuses unbounded financial fragments", () => {
    expect(() => parseInlineXbrl(fixture(fact("example:Oversized", "1".repeat(262145))))).toThrow(
      /bounds/
    );
  });

  it("reads real dimensions, scale, dates, currency and derived gross profit", () => {
    const period = extract(fixture())[0];
    expect(period.id).toBe("FY2025");
    expect(period.metrics.revenue).toBe(100_000_000);
    expect(period.metrics.grossProfit).toBe(40_000_000);
    expect(period.segments?.[0].revenue).toBe(100_000_000);
    expect(period.derived).toBe(true);
  });

  it("prefers precise statement facts over rounded narrative repeats", () => {
    const rounded =
      '<ix:nonFraction name="us-gaap:IncomeTaxExpenseBenefit" contextRef="total" unitRef="usd" scale="6" decimals="-7">0</ix:nonFraction>';
    expect(extract(fixture(rounded))[0].metrics.incomeTax).toBe(3_000_000);
  });

  it("rejects conflicting equally precise values", () => {
    expect(() => extract(fixture(fact("us-gaap:Revenues", "101")))).toThrow(/Conflicting/);
  });

  it("does not combine a subtotal and its dimensional children", () => {
    const extra =
      context(
        "child",
        '<xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">example:BusinessMember</xbrldi:explicitMember><xbrldi:explicitMember dimension="example:SubproductAxis">example:ChildMember</xbrldi:explicitMember>'
      ) + fact("us-gaap:Revenues", "75", "child");
    expect(extract(fixture(extra))[0].segments?.[0].revenue).toBe(100_000_000);
  });

  it("preserves signed facts and refuses unknown currency namespaces or mixed numeric markup", () => {
    const parsed = parseInlineXbrl(
      fixture(fact("us-gaap:RevenueNotFromContractWithCustomer", "2", "total", 'sign="-"'))
    );
    expect(
      parsed.facts.find((entry) => entry.tag === "us-gaap:RevenueNotFromContractWithCustomer")
        ?.value
    ).toBe(-2_000_000);
    expect(() => parseInlineXbrl(fixture().replace("iso4217:USD", "unsupported:USD"))).toThrow(
      /No monetary/
    );
    expect(
      extract(fixture().replace(">100</ix:nonFraction>", ">1<span>00</span></ix:nonFraction>"))
    ).toHaveLength(0);
  });

  it("never sends the authorized SEC contact to a different domain or protocol", () => {
    expect(() => assertSecUrl("https://data.sec.gov/submissions/CIK0000320193.json")).not.toThrow();
    for (const url of [
      "https://sec.gov.evil.test/data",
      "http://www.sec.gov/data",
      "https://www.federalreserve.gov/",
      "https://evil.test/?sec.gov"
    ])
      expect(() => assertSecUrl(url)).toThrow();
  });
});

describe("actual automatically crawled snapshot", () => {
  it("contains no demo company or manually overlaid public period", () => {
    expect(() => assertPublishableManifest(snapshot as FinanceManifest)).not.toThrow();
    expect(crawled.companies).toHaveLength(7);
    for (const company of crawled.companies) {
      expect(company.dataStatus).toBe("verified");
      for (const period of [...company.annual, ...company.quarterly]) {
        expect(period.sourceUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\//);
        expect(period.segments!.length).toBeGreaterThan(1);
        expect(() => validatePeriod(period)).not.toThrow();
        if (period.kind === "quarterly") expect(period.label).toMatch(/^Q[1-4] FY\d{4}$/);
      }
    }
  });

  it("keeps actual Alphabet hedging and Amazon after-tax equity-method losses", () => {
    const google = crawled.companies
      .find((company) => company.ticker === "GOOGL")!
      .annual.find((period) => period.id === "FY2025")!;
    expect(google.revenueAdjustments?.[0].revenue).toBe(-127_000_000);
    const amazon = crawled.companies
      .find((company) => company.ticker === "AMZN")!
      .annual.find((period) => period.id === "FY2025")!;
    expect(amazon.metrics.equityMethodIncome).toBe(-554_000_000);
    expect(amazon.operatingExpenseDetails).toHaveLength(5);
  });

  it("uses TWD-native figures and the same actual FX rate for every financial field", () => {
    const tsm = crawled.companies.find((company) => company.ticker === "TSM")!;
    for (const period of [...tsm.annual, ...tsm.quarterly]) {
      expect(period.reportingCurrency).toBe("TWD");
      expect(period.fx?.rate).toBeGreaterThan(0);
      expect(period.fx?.sourceUrl).toContain("federalreserve.gov");
    }
  });
});

describe("FX coverage", () => {
  it("parses the current Federal Reserve DD-MON-YY date format", () => {
    const result = parseH10TaiwanDollar(
      "<td>02-JAN-25</td><td>32.5</td><td>03-JAN-25</td><td>32.7</td>"
    );
    expect(result.map((item) => item.date)).toEqual(["2025-01-02", "2025-01-03"]);
  });

  it("refuses to use a tiny partial sample for a full-year conversion", () => {
    expect(() =>
      averageRate([{ date: "2025-01-02", rate: 32.5 }], "2025-01-01", "2025-12-31")
    ).toThrow(/Incomplete/);
  });
});
